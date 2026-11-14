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
