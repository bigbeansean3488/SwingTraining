# 球隊訓練：棒球隊管理與訓練分析平台

給一支成棒球隊隊內使用的網頁 App（PWA）：球隊管理、訓練紀錄、手機影片骨架分析、比賽記錄，並把訓練與比賽放在同一條時間軸上對照。

- 只用免費服務：Cloudflare Pages（代管）、Supabase 免費方案（登入與資料庫）、GitHub Actions（CI、保活、備份）。
- 影片在手機瀏覽器內分析，**不會上傳**。只同步骨架座標、指標與少量關鍵幀截圖。
- 沒網路也能分析與記錄，恢復連線後自動同步。

專案依據見 [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md)，進度見 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

## 功能

| 頁面 | 內容 |
|---|---|
| 分析 | 選取側面機位影片 → 逐幀骨架推論 → 疊圖播放（逐幀、慢速）→ 打擊／投球分期與指標、關鍵幀、跟自己歷史比較、並排比較、匯出 JSON；拍攝引導、診斷頁 |
| 訓練 | 課表（全隊／個人）、打擊數、牛棚球種與球數、體能測驗、自訂項目 |
| 比賽 | 簡化（逐打席）或逐球記錄、跑壘、換人、可修改刪除；打擊／投球／守備數據、落點圖、用球數 |
| 更多 | 帳號與同步、球隊（名單、角色、球季、邀請連結）、行事曆與出席、球員檔案與趨勢、報表（時間軸、教練總覽、CSV）、設定與用量 |

## 文件

- [`docs/METRICS.md`](docs/METRICS.md)：每個動作指標的定義、公式、濾波參數、限制與參考文獻
- [`docs/DECISIONS.md`](docs/DECISIONS.md)：技術決定與理由、技術風險驗證狀態
- [`docs/SCORING_SCOPE.md`](docs/SCORING_SCOPE.md)：比賽記錄支援範圍（待確認）
- [`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md)：Supabase、Google 登入、保活與備份設定步驟

## 本機開發

需要 Node.js 22 以上。

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # lint + 型別檢查 + 測試 + 建置（與 CI 相同）
```

`npm install` 會把 MediaPipe 的 wasm 執行檔複製到 `public/mediapipe/`（不進版本控制）。

## 部署到 Cloudflare Pages（需要你本人操作）

只需做一次。之後每次合併到 `main` 會自動部署。

1. 到 <https://dash.cloudflare.com/sign-up> 用 Email 註冊免費帳號（**不需要信用卡**；如果任何畫面要求付款資訊，停下來不要填）。
2. 登入後，左側選單點 **Workers & Pages** → **Create application**。
   畫面預設可能是 Workers；請切到 **Pages** 分頁（或點「Looking to deploy Pages? Get started」），選 **Import an existing Git repository**。
3. 點 **Connect GitHub**，授權 Cloudflare 存取 GitHub，可以只授權 `SwingTraining` 這一個儲存庫。
4. 選擇儲存庫 `SwingTraining` → **Begin setup**，填寫：
   - **Project name**：例如 `ncku-baseball`（網址會是 `https://ncku-baseball.pages.dev`，名稱一旦建立就不能改）
   - **Production branch**：`main`
   - **Framework preset**：`None`
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - **Environment variables**：階段 0 先不用填。階段 2 會加 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`（見下方）。
5. 點 **Save and Deploy**，等第一次建置完成（約 1～2 分鐘）。
6. **節省建置次數**（免費方案每月 500 次）：進入專案 → **Settings** → **Builds** →
   **Branch control** → 把 **Preview branch** 改成 **None**（只有 `main` 會部署）→ 儲存。
7. 用手機打開 `https://<project-name>.pages.dev`：
   - iPhone Safari：分享按鈕 → **加入主畫面**。
   - Android Chrome：右上選單 → **安裝應用程式**（或「加到主畫面」）。

**做完請回報**：部署後的網址，以及手機能否開啟首頁、能否加入主畫面。

## 部署對外的單獨分析版（選用，需要你本人操作）

給球隊以外的人用的版本（D27）：只有打擊／投球分析，沒有登入、球隊、訓練、比賽功能，不連 Supabase，資料只存在使用者自己的手機。跟球隊版用同一個儲存庫，合併到 `main` 時兩個網址會一起更新。

1. Cloudflare → **Workers & Pages** → **Create application** → **Pages** → **Import an existing Git repository**，再選一次 `SwingTraining`。
2. 填寫：
   - **Project name**：例如 `ncku-swing`（網址 `https://ncku-swing.pages.dev`，跟球隊版不同）
   - **Production branch**：`main`
   - **Framework preset**：`None`
   - **Build command**：`npm run build:solo`
   - **Build output directory**：`dist`
   - **Environment variables**：**不要填**任何 Supabase 變數（填了也不會用到）。
3. **Save and Deploy**，再到 **Settings** → **Builds** → **Branch control** 把 **Preview branch** 改成 **None**。
4. 注意：兩個專案共用每月 500 次的免費建置額度，每次合併到 `main` 會用掉 2 次。

**做完請回報**：單獨版的網址，以及另一支沒登入過的手機能否打開、分析一支影片、匯出備份檔。

## 設定 Supabase（階段 2，需要你本人操作）

見 [`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md)。沒設定 Supabase 時，App 以「本機模式」運作：所有功能都能用，資料只存在這支手機。

## 目錄

```
src/analysis/   純函式分析引擎（含單元測試）
src/scoring/    純函式比賽計分引擎（含單元測試）
src/pose/       MediaPipe 包裝、影片逐幀擷取
src/features/   各功能頁面
src/lib/        本機資料庫、同步、Supabase client、共用工具
src/ui/         共用元件與樣式
supabase/       SQL migration
tests/fixtures/ 合成的關鍵點測試資料（不含真人影片）
docs/           任務書、進度、指標定義、技術決定
```
