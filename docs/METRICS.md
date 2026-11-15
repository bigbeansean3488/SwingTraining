# 動作指標定義

> 單支手機、單一視角得到的是 **2D 資料**。以下所有指標都是**相對值與趨勢參考，不是實驗室等級的量測**，只適合跟球員自己的歷史比較。介面上每個結果頁都顯示這段說明。

- 分析引擎版本：`ENGINE_VERSION = 1.0.0`（`src/analysis/common.ts`）。公式或參數改變時要調高版本並更新本文件。
- 程式：`src/analysis/`（純函式），測試：`src/analysis/*.test.ts`，測試資料：`tests/fixtures/*.json`（合成關鍵點，由 `scripts/make-fixtures.ts` 產生）。

## 1. 共同處理流程

### 1.1 輸入
MediaPipe Pose Landmarker 每幀 33 個關鍵點（影像正規化座標 x、y ∈ [0,1] 與 visibility）。先乘上影像寬高轉成像素，避免直式影片的長寬比扭曲距離與角度。

### 1.2 重新取樣與補洞
- 以時間戳的中位數間隔估計實際幀率 fs，重新取樣到等間隔時間格（線性內插）。
- visibility < 0.3 的點視為缺失。**最多內插 0.1 秒**的缺口；更長的缺口保持缺失，不捏造資料。

### 1.3 濾波
- **四階零相位 Butterworth 低通**：二階 Butterworth 正向、反向各跑一次（`lowpassZeroLag`）。雙向濾波會讓截止頻率下移，依 Winter (2009) 用 fc / 0.802 修正，使 −3 dB 落在設定值。邊緣以奇對稱延伸減少暫態。
- 位置類（位移、角度、事件偵測）：**12 Hz**。
- 手腕速度：**20 Hz**（快速動作的峰值需要較高頻寬）。
- 兩者都不超過 0.4 × fs（30 fps 影片會降到 12 Hz）。
- 速度用中央差分計算。

### 1.4 正規化
- 長度一律除以**軀幹長**：肩膀中點到髖部中點的距離，取整段影片的中位數。介面顯示「軀幹長」單位，不顯示像素或公分。
- 選軀幹長而非身高：側面機位下打者／投手多半屈膝，畫面上的「身高」不穩定；肩寬在側面視角會被壓縮。軀幹長在動作中變化最小。

### 1.5 動作方向與前腳
- 前腳（跨步腳）＝兩腳踝中水平移動範圍（第 5～95 百分位）較大的一隻。
- 「往前」（投手方向／本壘方向）＝前腳踝離開起始位置最遠時的方向。不依賴 MediaPipe 的左右標籤（側面視角左右常會對調），左右打／投都適用。

### 1.6 品質管制（不可靠就不給數字）
| 檢查 | 門檻 | 結果 |
|---|---|---|
| 實際幀率 | < 24 fps | 拒絕（`fps_too_low`） |
| 實際幀率 | < 100 fps | 警告：時間類指標精度有限 |
| 每幀信心值 | 關鍵點（鼻、肩、腕、髖、膝、踝）visibility 平均 | ≥ 0.5 算追蹤成功 |
| 整段影片 | 追蹤成功 < 50% | 拒絕（`tracking_poor`） |
| 動作區間（抬腳前 0.2 秒到收尾） | 追蹤成功 < 80% | 拒絕（`tracking_window`） |
| 軀幹長 | < 20 像素 | 拒絕（`person_too_small`） |
| 事件順序 | 不符合時間先後 | 拒絕（`events_not_found`） |
| 前腳著地到擊球／出手 | > 1.2 秒 | 拒絕（`timing_implausible`，常見原因是慢動作被拉長成一般速度） |

每個指標另附**信心值**＝計算時用到的關鍵點在用到的幀上的 visibility 平均；< 0.6 時介面標黃色。

### 1.7 時間倍率
慢動作若被轉成一般速度播放（例如 240 fps 拍攝、以 30 fps 播放），使用者可填入實際拍攝 fps，時間乘上 `影片 fps / 實際 fps`。事件時間仍以影片時間保存（疊圖才對得上），時間長度以真實時間計算。

### 1.8 手動修正事件
使用者可在疊圖播放器把任一事件設為目前畫面，引擎以修正後的時間重算所有指標，並保存 `manual_events`。保存的關鍵點可隨時用新版引擎重算。

## 2. 打擊（側面機位：鏡頭垂直於投打連線、面對打者正面）

### 2.1 事件偵測
| 事件 | 定義 |
|---|---|
| 擊球（contact） | 兩手腕中點速度（20 Hz 濾波）的最大值時刻。**這是估計值**：沒有追蹤球與球棒，用手部速度峰值代理擊球瞬間（文獻顯示手部線速度在擊球前後達到峰值，Welch et al. 1995）。 |
| 前腳著地（plant） | 擊球前前腳踝速度峰值之後，前腳踝速度第一次降到 max(峰值 20%, 0.5 軀幹長/秒) 以下。 |
| 抬腳（load） | 由前腳踝速度峰值往前回推，速度降到 max(峰值 10%, 0.15 軀幹長/秒) 以下的時刻。 |
| 收棒（finish） | 擊球後手部速度降到峰值 25% 以下；不在影片內則取最後一幀並警告。 |
| 預備（stance） | 分析範圍的第一幀。 |

### 2.2 指標
| 鍵 | 名稱 | 公式 | 單位 | 依據 |
|---|---|---|---|---|
| `phase_stance_ms` | 預備時間 | load − stance（受錄影開始時間影響，僅供參考） | ms | Welch 1995 分期 |
| `phase_load_ms` | 抬腳→前腳著地 | plant − load | ms | Welch 1995 |
| `phase_plant_to_contact_ms` | 前腳著地→擊球 | contact − plant | ms | Welch 1995 |
| `phase_follow_ms` | 擊球→收棒 | finish − contact | ms | Welch 1995 |
| `stride_length` | 跨步長度 | (前腳踝 x@plant − 預備位置 x) × 方向 ÷ 軀幹長；預備位置＝抬腳前 0.2 秒內的中位數 | 軀幹長 | Welch 1995；Escamilla et al. 2009 |
| `pelvis_shift` | 重心前移量 | (髖部中點 x@contact − 預備位置) × 方向 ÷ 軀幹長（骨盆中心為重心代理） | 軀幹長 | Welch 1995（重心前移） |
| `head_dx` | 頭部水平位移 | (鼻 x@contact − 預備) × 方向 ÷ 軀幹長；正值往投手方向 | 軀幹長 | Welch 1995（頭部穩定） |
| `head_dy` | 頭部垂直位移 | (預備 y − 鼻 y@contact) ÷ 軀幹長；正值上升 | 軀幹長 | 同上 |
| `lead_knee_plant` | 前膝角度（著地） | ∠ 髖-膝-踝 @plant，180° 伸直 | ° | Escamilla et al. 2009 |
| `lead_knee_contact` | 前膝角度（擊球） | ∠ 髖-膝-踝 @contact | ° | Escamilla et al. 2009 |
| `trunk_tilt_contact` | 擊球瞬間軀幹傾斜 | 髖中點→肩中點連線與影像垂直線的有號夾角；正值往投手方向 | ° | Welch 1995 |
| `wrist_peak_speed` | 手腕最大速度 | max ‖d(兩腕中點)/dt‖ ÷ 軀幹長（plant 到 finish 之間） | 軀幹長/秒 | Welch 1995 |
| `wrist_peak_time_ms` | 手腕最大速度時間點 | t(峰值) − plant | ms | 同上 |
| `seq_pelvis_lead_ms` | 骨盆與肩膀啟動順序（**實驗性**） | 肩寬投影收窄的啟動時刻 − 髖寬投影收窄的啟動時刻；啟動＝收窄速度首次超過其峰值 30%（plant 前 0.25 秒到 contact 之間）；正值＝骨盆先 | ms | 序列概念：Welch 1995；2D 代理量無文獻驗證 |

### 2.3 限制
- 2D 投影：膝角與軀幹角是畫面上的角度，球員沒有正對鏡頭時會失真。
- 擊球時刻是手部速度峰值的估計，不是真正的球棒觸球。
- 遠側手腕常被身體遮擋（舊專案在 iPhone 影片觀察到遠側手腕 visibility 中位數約 0.4），手腕速度會偏低或抖動；兩腕中點在一側缺失時退用另一側。
- 手腕速度不是棒速，不可換算成公里／小時。
- 啟動順序：真正的轉動角度無法從單一 2D 視角取得，寬度變化也會受身體前後移動影響，因此標示為實驗性、信心值減半。

## 3. 投球（側面機位：鏡頭垂直於投球方向、面對投手正面）

### 3.1 事件偵測
| 事件 | 定義 |
|---|---|
| 投球手 | 兩手腕中速度峰值（20 Hz 濾波）較高的一側。 |
| 出手（release） | 投球手腕速度最大值時刻。**估計值**：沒有追蹤球，以手部速度峰值代理出手（Fleisig et al. 1996 的分期中，出手接近手部線速度最大）。 |
| 前腳著地（plant） | 出手前前腳踝速度峰值之後，速度第一次降到 max(峰值 20%, 0.5 軀幹長/秒) 以下。 |
| 抬腿最高點（liftTop） | 前腳著地之前，前膝在畫面上最高（y 最小）的時刻。 |
| 收尾（finish） | 出手後投球手腕速度降到峰值 25% 以下；不在影片內則取最後一幀並警告。 |

### 3.2 指標
| 鍵 | 名稱 | 公式 | 單位 | 依據 |
|---|---|---|---|---|
| `phase_lift_to_plant_ms` | 抬腿最高點→前腳著地 | plant − liftTop | ms | Fleisig 1996 分期 |
| `phase_plant_to_release_ms` | 前腳著地→出手 | release − plant | ms | Fleisig 1996 |
| `phase_release_to_finish_ms` | 出手→收尾 | finish − release | ms | Fleisig 1996 |
| `phase_lift_to_release_ms` | 抬腿最高點→出手（總時間） | release − liftTop | ms | 任務書指定 |
| `stride_length` | 跨步長度 | (前腳踝 x − 軸心腳踝 x)@plant × 方向 ÷ 軀幹長 | 軀幹長 | Fleisig et al. 1999（跨步長，文獻以身高百分比表示） |
| `lead_knee_plant` | 前膝角度（著地） | ∠ 髖-膝-踝 @plant | ° | Fleisig 1999 |
| `lead_knee_release` | 前膝角度（出手） | ∠ 髖-膝-踝 @release | ° | Fleisig 1999 |
| `trunk_forward_release` | 出手瞬間軀幹前傾 | 髖中點→肩中點與垂直線的有號夾角，正值往本壘方向 | ° | Fleisig 1999；Stodden et al. 2005 |
| `elbow_height_plant` | 著地瞬間手肘相對肩線高度 | 投球手肘到「兩肩連線在手肘 x 位置的高度」的垂直距離 ÷ 軀幹長；正值＝高於肩線。兩肩水平距離 < 0.05 軀幹長時不計算 | 軀幹長 | 對應文獻的「著地瞬間肩外展角」（Fleisig 1999），2D 代理量 |

### 3.3 限制
- 出手時刻是手腕速度峰值的估計；快速揮臂時影像模糊，手腕追蹤可能抖動或落後。
- 側面視角下兩肩可能前後重疊，此時肩線方向不可靠（手肘高度會被略過）。
- 跨步長度以軸心腳為起點，若軸心腳在著地前已離開投手板，數值會偏小。
- 軀幹前傾是 2D 投影角度，包含側傾成分。

## 4. 回饋文字規則（`src/analysis/feedback.ts`）
- 至少要有 3 筆同球員、同類型、同主版本引擎、通過品質管制、日期較早的分析才會比較。
- 差值 |本次 − 個人平均| ≤ max(個人標準差, 最小差值) → 「與你的平均相近」；否則「變大／變小」（部分指標用「更往投手方向」等描述方向的詞）。最小差值：軀幹長 0.05、角度 3°、時間 20 ms、速度 1 軀幹長/秒。
- 累積 8 筆以上時，比較最近 5 筆與更早資料的標準差：比值 < 0.7 →「最近 5 次變穩定」，> 1.4 →「波動變大」。
- **不做**好壞評分、不給傷害風險或醫療相關判斷。

## 5. 參考文獻
> 以下為公開發表的生物力學文獻，作為指標選擇與分期定義的依據。引用前請以原文核對細節。

1. Winter, D. A. (2009). *Biomechanics and Motor Control of Human Movement* (4th ed.). Wiley.（數位濾波、雙向濾波截止頻率修正）
2. Welch, C. M., Banks, S. A., Cook, F. F., & Draovitch, P. (1995). Hitting a baseball: A biomechanical description. *Journal of Orthopaedic & Sports Physical Therapy, 22*(5), 193–201.
3. Escamilla, R. F., Fleisig, G. S., DeRenne, C., Taylor, M. K., Moorman, C. T., Imamura, R., Barakatt, E., & Andrews, J. R. (2009). A comparison of age level on baseball hitting kinematics. *Journal of Applied Biomechanics, 25*(3), 210–218.
4. Fleisig, G. S., Barrentine, S. W., Escamilla, R. F., & Andrews, J. R. (1996). Biomechanics of overhand throwing with implications for injuries. *Sports Medicine, 21*(6), 421–437.
5. Fleisig, G. S., Barrentine, S. W., Zheng, N., Escamilla, R. F., & Andrews, J. R. (1999). Kinematic and kinetic comparison of baseball pitching among various levels of development. *Journal of Biomechanics, 32*(12), 1371–1375.
6. Stodden, D. F., Fleisig, G. S., McLean, S. P., & Andrews, J. R. (2005). Relationship of biomechanical factors to baseball pitching velocity: Within pitcher variation. *Journal of Applied Biomechanics, 21*(1), 44–56.
7. Bazarevsky, V., Grishchenko, I., Raveendran, K., Zhu, T., Zhang, F., & Grundmann, M. (2020). BlazePose: On-device real-time body pose tracking. *arXiv:2006.10204*.
