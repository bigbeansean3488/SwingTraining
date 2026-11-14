# 球隊訓練：棒球隊管理與訓練分析平台

給一支成棒球隊隊內使用的網頁 App（PWA）：球隊管理、訓練紀錄、手機影片骨架分析、比賽記錄，並把訓練與比賽放在同一條時間軸上對照。

- 只用免費服務：Cloudflare Pages（代管）、Supabase 免費方案（登入與資料庫）、GitHub Actions（CI、保活、備份）。
- 影片在手機瀏覽器內分析，**不會上傳**。只同步骨架座標、指標與少量關鍵幀截圖。
- 沒網路也能分析與記錄，恢復連線後自動同步。

專案依據見 [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md)，進度見 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

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

## 設定 Supabase（階段 2，需要你本人操作）

見 [`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md)。沒設定 Supabase 時，App 以「本機模式」運作：所有功能都能用，資料只存在這支手機。

## 目錄

```
src/analysis/   純函式分析引擎（含單元測試）
src/pose/       MediaPipe 包裝、影片逐幀擷取
src/features/   各功能頁面
src/lib/        本機資料庫、同步、Supabase client、共用工具
src/ui/         共用元件與樣式
supabase/       SQL migration
tests/fixtures/ 合成的關鍵點測試資料（不含真人影片）
docs/           任務書、進度、指標定義、技術決定
```
