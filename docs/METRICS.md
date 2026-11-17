# 動作指標定義

> 單支手機、單一視角得到的是 **2D 資料**。以下所有指標都是**相對值與趨勢參考，不是實驗室等級的量測**，只適合跟球員自己的歷史比較（以及隊上指定的標竿動作，見 §4.2）。介面上每個結果頁都顯示這段說明。

- 分析引擎版本：`ENGINE_VERSION = 1.1.0`（`src/analysis/common.ts`）。公式或參數改變時要調高版本並更新本文件。
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

### 1.5 動作方向與前腳（1.1.0 起）
- **左右腳標籤修正**：側面視角下 MediaPipe 常把左右腳的標籤對調一段時間。濾波前逐幀比較膝蓋與腳踝的位置：如果「左右對調」的配對比「維持原標籤」的配對更接近上一幀（距離和小於一半），就把這一幀膝蓋到腳尖的左右標籤換回來（`fixLegLabelSwaps`）。兩腳交錯時差距不明顯，不會換。
- **打擊**：
  - 前腳＝**擊球前**（手部速度峰值之前）兩腳踝水平移動範圍（第 5～95 百分位）較大的一隻。
  - 「往前」＝預備姿勢中前腳相對於後腳的方向（前腳一定比較靠近投手）。兩腳距離小於 0.3 軀幹長、看不出來時，改用前腳踝離開起始位置最遠的方向。
- **投球**：
  - 前腳＝**出手前**膝蓋抬得比較高的一隻（抬腿）。兩膝抬高差距小於 0.15 軀幹長時，改用投球手的另一側。
  - 「往前」＝出手前骨盆移動的方向；移動小於 0.2 軀幹長時，改用前腳踝移動的方向。
  - 1.0.0 用整段影片判斷前腳；出手後後腳往前甩的距離常比前腳大，會被誤認成前腳，造成跨步為負、前膝角度量到另一隻腳。
- **逐幀防呆**：量測的那一幀如果標籤上的前腳踝明顯在後腳踝後面（超過 0.05 軀幹長），視為標籤對調，改用另一隻腳（`sidesAt`），跨步與前膝角度都適用。

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
| `stride_length` | 跨步長度 | (前腳踝 x@plant − 預備位置 x) × 方向 ÷ 軀幹長；預備位置＝抬腳前 0.2 秒內前腳踝的中位數。介於 −0.1 與 0 之間記為 0；小於 −0.1 視為量不出來，不給數字並警告（`stride_implausible`） | 軀幹長 | Welch 1995；Escamilla et al. 2009 |
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
| `stride_length` | 跨步長度 | (前腳踝 x − 軸心腳踝 x)@plant × 方向 ÷ 軀幹長；負值處理同打擊 | 軀幹長 | Fleisig et al. 1999（跨步長，文獻以身高百分比表示） |
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

### 4.1 結果頁的呈現（2026-11-15 起，不影響指標數值）
- **個人範圍**（`positionInRange`）：拿本次跟同球員之前最多 20 次可比較的分析（至少 3 次）比較：低於最小值 →「比你之前 N 次都小」，高於最大值 →「都大」，否則依落在範圍的下、中、上三分之一說「偏小／中間／偏大」。「大／小」依指標換成白話，例如時間「長／短」、膝角「直／彎」。
- **與標記為好的動作比較**（`compareWithReference`）：球員或教練可以把某幾次分析標記為「好的動作」（欄位 `motion_analyses.marked_good`）。本次與這些分析的平均比較，門檻 = max(好動作之間的標準差, 最小差值)；只有一次好動作時只用最小差值。結果頁「重點摘要」列出差值 ÷ 門檻最大的 3 項。比較對象是球員自己的動作，不是外部標準。
- **量測位置圖**（`src/analysis/figures.ts`）：用與指標相同的濾波、前腳判斷與事件影格，算出角度的三個點或位移的起訖點，畫在關鍵幀上（沒有關鍵幀時畫在骨架上）。單元測試確認從圖上量回的數值等於指標（`figures.test.ts`）。
- **研究怎麼說**：部分指標附公開文獻的一般觀察與出處（`src/features/analyze/literature.ts`），只寫能在原文摘要或主要整理中查到的內容，並註明不是個人建議（見 DECISIONS D19）。
- **研究樣本 PR 與參考範圍**（`src/analysis/researchSample.ts`，2026-11-17 起）：把本次數值放進 OpenBiomechanics Project 研究樣本的分布，算 PR 值（1～99，用 5% 分位數線性內插）與區間：P25～P75「常見範圍」、P10～P90 以外「少見」。樣本用本引擎的自動事件偵測、投影成正側面後計算，每位選手取平均。只有引擎主版本相同時才顯示。方法與限制見 `docs/REFERENCE_DATA.md`（DECISIONS D23）。不是好壞評分。

### 4.2 與標竿動作對照（2026-11-17 起，`src/analysis/reference.ts`，不影響指標數值）
標竿＝隊上選來模仿的一次動作分析的複本（骨架、事件、指標；不含影片），見 DECISIONS D22。這一節只是**呈現與對齊方式**，指標公式沒有改變，所以 `ENGINE_VERSION` 維持 1.1.0。
- **時間對齊**（`buildTimeWarp`、`warpTime`）：取兩邊都有的事件（打擊：抬腳、前腳著地、擊球、收棒；投球：抬腿最高點、前腳著地、出手、收尾）當錨點，相鄰錨點之間線性對應，所以每一段依兩邊的長短拉伸。事件順序在任一邊倒退的錨點略過。第一個錨點之前與最後一個之後以**真實時間**延伸（考慮慢動作時間倍率）。沒有共同事件時從開頭以真實時間對齊並提示。
- **骨架正規化**（`normalizeSequence`）：每幀以髖部中點為原點，座標換成像素後除以整段影片的軀幹長中位數（肩中點到髖中點），並乘上動作方向使動作一律朝右（+x）。因此身高、拍攝距離、畫面位置與左右投打不影響骨架比較。visibility < 0.3 的點不畫。標竿影格率較低時，兩幀之間線性內插。
- **指標差異**（`diffMetrics`）：同一指標、同一單位時列出「你 − 標竿」。|差| ≤ 最小差值（與 §4 相同：軀幹長 0.05、角度 3°、時間 20 ms、速度 1 軀幹長/秒）時說「跟標竿相近」，否則用指標的白話方向詞，例如「比標竿短 0.20 軀幹長」「比標竿彎 8°」。任一邊信心值 < 0.6 時加註。舊版（1.0.x）存下的負跨步不比較。
- **可比性提示**（`comparability`）：引擎主版本不同、任一邊有品質提醒（例如影格率 < 100 fps、動作沒拍完整）、任一邊動作方向未知、沒有共同事件時，顯示「差異只能參考」與原因。
- 不做好壞評分、不算 PR 值；「不一樣」不代表「比較差」。
- 測試：`src/analysis/reference.test.ts`（合成資料：不同節奏的事件對齊、慢動作時間倍率、拍攝距離與畫面位置不同、左右投鏡像、差異方向與門檻）。

## 5. 參考文獻
> 以下為公開發表的生物力學文獻，作為指標選擇與分期定義的依據。引用前請以原文核對細節。

1. Winter, D. A. (2009). *Biomechanics and Motor Control of Human Movement* (4th ed.). Wiley.（數位濾波、雙向濾波截止頻率修正）
2. Welch, C. M., Banks, S. A., Cook, F. F., & Draovitch, P. (1995). Hitting a baseball: A biomechanical description. *Journal of Orthopaedic & Sports Physical Therapy, 22*(5), 193–201.
3. Escamilla, R. F., Fleisig, G. S., DeRenne, C., Taylor, M. K., Moorman, C. T., Imamura, R., Barakatt, E., & Andrews, J. R. (2009). A comparison of age level on baseball hitting kinematics. *Journal of Applied Biomechanics, 25*(3), 210–218.
4. Fleisig, G. S., Barrentine, S. W., Escamilla, R. F., & Andrews, J. R. (1996). Biomechanics of overhand throwing with implications for injuries. *Sports Medicine, 21*(6), 421–437.
5. Fleisig, G. S., Barrentine, S. W., Zheng, N., Escamilla, R. F., & Andrews, J. R. (1999). Kinematic and kinetic comparison of baseball pitching among various levels of development. *Journal of Biomechanics, 32*(12), 1371–1375.
6. Stodden, D. F., Fleisig, G. S., McLean, S. P., & Andrews, J. R. (2005). Relationship of biomechanical factors to baseball pitching velocity: Within pitcher variation. *Journal of Applied Biomechanics, 21*(1), 44–56.
7. Bazarevsky, V., Grishchenko, I., Raveendran, K., Zhu, T., Zhang, F., & Grundmann, M. (2020). BlazePose: On-device real-time body pose tracking. *arXiv:2006.10204*.
8. Matsuo, T., Escamilla, R. F., Fleisig, G. S., Barrentine, S. W., & Andrews, J. R. (2001). Comparison of kinematic and temporal parameters between different pitch velocity groups. *Journal of Applied Biomechanics, 17*(1), 1–13.（「研究怎麼說」：投球前膝、軀幹前傾）
9. Fleisig, G. S. (2010). Biomechanics of baseball pitching: Implications for injury and performance. *Proceedings of the XXVIII International Symposium of Biomechanics in Sports*.（「研究怎麼說」：跨步佔身高百分比）
10. Kishita, Y., Ueda, H., & Kashino, M. (2020). Eye and head movements of elite baseball players in real batting. *Frontiers in Sports and Active Living, 2*, 3.（「研究怎麼說」：頭部）
11. Kishita, Y., Ueda, H., & Kashino, M. (2020). Temporally coupled coordination of eye and body movements in baseball batting for a wide range of ball speeds. *Frontiers in Sports and Active Living, 2*, 64.（「研究怎麼說」：頭部）
12. Driveline Baseball Research and Development. *The OpenBiomechanics Project (OBP)*, dataset-v1. https://github.com/drivelineresearch/openbiomechanics（CC BY-NC-SA 4.0；研究樣本參考範圍，見 `docs/REFERENCE_DATA.md`）
