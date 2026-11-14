# 技術決定與理由

每筆決定記錄：日期、決定、理由、影響。需要使用者確認的標記 **【待確認】**。

## D1：沿用原儲存庫，舊程式保留在 tag（2026-11-14）
- 決定：在原 `SwingTraining` 儲存庫重建，舊的純 JS 揮棒分析專案保留在 tag `legacy-v0`。
- 理由：保留歷史與 GitHub 設定；舊程式隨時可用 `git checkout legacy-v0` 取回參考。
- 舊專案的經驗（見 `legacy-v0:docs/validation-status.md`）：在桌機 Chrome 上 4K 影片逐步 seek 每幀約 0.9 秒、播放式擷取的關鍵點落後 0.2～0.3 秒。這直接影響 D6。

## D2：TypeScript 用 6.0，不用 7.0（2026-11-14）
- 決定：`typescript@~6.0.3`。
- 理由：npm 上最新是 7.0.2，但 `typescript-eslint@8.72` 的 peer 依賴是 `typescript <6.1`，用 7.0 會讓 ESLint 型別規則失效。等 typescript-eslint 支援 7 再升級。

## D3：雜湊路由（`#/path`）（2026-11-14）
- 決定：自己寫約 40 行的 hash router，不引入 react-router。
- 理由：靜態代管與已安裝的 PWA 都不需要伺服器改寫規則；少一個依賴。

## D4：Cloudflare Pages 用 Git 整合部署，只部署 `main`（2026-11-14）
- 決定：Cloudflare 直接連 GitHub，Preview branch 設為 None。
- 理由：設定最簡單、不需要 API token；只有合併到 `main` 才算一次建置（免費 500 次／月，2026-11 官方文件確認）。CI（lint／測試）在 GitHub Actions 跑，不佔 Cloudflare 建置次數。

## D5：MediaPipe wasm 自行代管，模型從 Google 下載後快取（2026-11-14）
- 決定：`npm install` 時把 `@mediapipe/tasks-vision` 的 wasm 複製到 `public/mediapipe/wasm`，由我們的網域提供；`.task` 模型檔從 `storage.googleapis.com/mediapipe-models` 下載，service worker 用 CacheFirst 快取。
- 理由：wasm 版本與 npm 套件一致，不受 CDN 影響；第一次分析後即可離線分析。不預先快取（約 10～30 MB），避免每個使用者安裝 PWA 時都下載。
- 影響：第一次分析需要網路。離線前請先在有網路時開一次分析頁（App 有「預先下載模型」按鈕）。

## D6：逐幀擷取優先用 WebCodecs，seek 作為備案 【待實機驗證】（2026-11-14）
- 決定：用 `mp4box.js` 解析 MP4/MOV 容器，`VideoDecoder`（WebCodecs）依序解碼每一幀，直接把 `VideoFrame` 送進 MediaPipe。瀏覽器不支援或解碼失敗時，退回「逐步 seek + `requestVideoFrameCallback` 確認畫面已更新」。
- 理由：
  - 舊專案實測 seek 每幀約 0.9 秒（4K），3 秒 240 fps＝720 幀會超過 10 分鐘，達不到 1 分鐘驗收。
  - 播放式（`requestVideoFrameCallback` 邊播邊推論）會跳幀，舊專案在無頭 Chrome 觀察到關鍵點落後，結果不可重現。
  - WebCodecs 依序解碼不需要 seek，每一幀都處理，時間戳直接來自容器（＝真實幀率），同一支影片每次輸入完全相同，結果可重現。
- 支援度（依文件，**未實機驗證**）：Android Chrome 支援 WebCodecs；iOS Safari 16.4 起支援 `VideoDecoder`。HEVC（iPhone 預設）是否能用 `VideoDecoder.isConfigSupported` 解碼要在實機確認。App 的「診斷」頁會顯示實際用了哪種方法。

## D7：Supabase 金鑰
- 決定：前端只用 Supabase 的 publishable（anon）金鑰，透過 Cloudflare Pages 的環境變數 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 注入。資料由列級權限（RLS）保護。`service_role`／secret 金鑰只放 GitHub Secrets 給備份用，絕不進前端。

## D8：npm audit 的已知警告（2026-11-14）
- `vite-plugin-pwa@2.0.0` → `workbox-build` 依賴有 moderate 等級警告（deepmerge、glob、minimatch）。只在建置時執行、不進到使用者的瀏覽器，風險可接受。`npm audit fix --force` 會降級到 vite-plugin-pwa 1.1，不採用。

## D9：階段 1 技術風險的驗證狀態（2026-11-14）

任務書要求驗證的四項風險。**目前只有桌機 Chrome 的數據，手機數據要等使用者實測**；App 的「分析 → 診斷與效能」頁會顯示每次分析的擷取方式、每幀耗時與 720 幀預估時間，截圖回報即可補進下表。

| # | 風險 | 目前做法 | 桌機 Chrome 實測 | iPhone Safari | Android Chrome |
|---|---|---|---|---|---|
| 1 | 慢動作從網頁選取後的實際幀率 | 用 mp4box 讀容器時間戳算真實幀率並顯示；< 100 fps 警告、< 24 fps 拒絕；動作時間異常長時提示「被拉長」；可手動填實際拍攝 fps。拍攝引導建議 iPhone 先「儲存到檔案」再從「檔案」選取 | 舊 iPhone 4K 影片讀到 31.6 fps（與舊專案量測一致） | ⏳ 待測：從「照片」與從「檔案」各選一次 240 fps 慢動作，記錄讀到的 fps 與長度 | ⏳ 待測 |
| 2 | 逐幀擷取方法 | WebCodecs（`VideoDecoder`）依序解碼為主，逐步 seek 為備案；`requestVideoFrameCallback` 只用來確認 seek 後畫面已更新（不用播放式擷取，因為會跳幀、結果不可重現） | WebCodecs 可用（H.264 4K 直式） | ⏳ 待測（重點：HEVC 能否用 WebCodecs） | ⏳ 待測 |
| 3 | 3 秒 240 fps 的處理時間 | 提供降採樣（每 2／4 幀）與模型選擇；分析範圍可裁切 | 4K、full 模型、GPU：126 幀 8.9～10.6 秒（約 70～84 ms/幀，含模型載入）→ 720 幀約 50～60 秒。舊 seek 做法約 900 ms/幀 | ⏳ 待測 | ⏳ 待測 |
| 4 | lite／full／heavy 取捨 | 預設 full，可在進階選項切換；「診斷」頁可預先下載三種模型 | 尚未系統比較 | ⏳ 待測 | ⏳ 待測 |

**可重現性**：同一支影片、同一範圍、同一模型分析兩次，壓縮後的關鍵點逐位元組相同（桌機 Chrome GPU）。做法：每次分析都建立新的 PoseLandmarker（VIDEO 模式會沿用前一幀的追蹤狀態，重用會讓結果受上一支影片影響），並把同樣的影格依同樣的時間戳送進模型。

## D10：本機優先、沒設定 Supabase 也能完整使用（2026-11-14）
- 所有資料先寫進 IndexedDB，同時記一筆到 outbox；有登入且有網路時才同步（階段 2）。
- 第一次開啟自動建立「我」這個球員檔案，所以不用註冊就能分析。登入後這個檔案會連結到帳號。

## D11：關鍵點儲存格式（2026-11-14）
- 只存 19 個用得到的關鍵點；座標量化成 16 位元（範圍 −0.25～1.25，精度約 0.04 像素 @1920）、visibility 8 位元，與前一幀做差分後 gzip，再轉 base64 存成文字欄位。
- 實測：126 幀約 14 KB，3 秒 240 fps（720 幀）約 80 KB。Supabase 500 MB 約可存 5,000 筆以上的分析。
- 有版本號（`KP` v1），可以用保存的關鍵點以新版引擎重算。

## D12：React 編譯器相關的 lint 規則關閉（2026-11-14）
- `eslint-plugin-react-hooks@7` 的 `set-state-in-effect`、`refs`、`use-memo` 是給 React Compiler 用的嚴格規則，會把常見且正確的 effect 寫法標成錯誤。本專案沒有使用 React Compiler，因此關閉這三條，其餘 hooks 規則保留。
