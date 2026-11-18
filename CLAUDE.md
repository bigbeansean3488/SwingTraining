# CLAUDE.md

給 Claude Code 的常駐規則。完整依據是 `docs/PROJECT_BRIEF.md`；每次開始工作前先讀它和 `docs/PROGRESS.md`。

## 溝通與語言
- 與使用者討論用繁體中文（台灣用語）。
- 介面文字、文件、提交訊息的說明用繁體中文；程式碼識別字與註解用英文。
- 介面以手機直向為主，按鈕要夠大（≥ 48px），戶外強光下可讀（高對比）。

## 不可違反的限制（摘自任務書 §2）
- **零費用**：只用免費方案。任何要付費、綁信用卡、買網域的做法，先停下來問使用者。
- 一支手機就能用：iOS Safari 與 Android Chrome；不需額外硬體、電腦或原生 App。
- 沒網路時核心功能（骨架分析、記錄輸入）仍可運作，恢復連線後同步。
- 不使用學校／研究室伺服器或 NAS。
- 不做逆向工程：不拆解、不抓取、不模仿 GameChanger、SwingX 等商用產品的程式、API、介面與評分公式。只參考公開記錄規則與生物力學文獻。
- 不做：比賽直播、影片精華剪輯、對外公開的球員頁面、金流。
- 不做：棒速、擊球仰角、擊球初速、球速、轉速、甜蜜點。
- 回饋文字只跟球員自己的歷史比較（變大／變小／變穩定），或跟球員自己標記為「好的動作」比較；不做好壞評分、不做傷害風險或醫療判斷。
- 例外（D19）：指標旁可附公開文獻的一般觀察，必須附出處、註明不是個人建議，只寫查證過的內容。

## 架構（摘自任務書 §3）
- Vite + React + TypeScript PWA，代管在 Cloudflare Pages（`*.pages.dev`）。
- 骨架分析：`@mediapipe/tasks-vision` Pose Landmarker，全部在瀏覽器內運算，影片不上傳。
- 後端：Supabase 免費方案（Auth、Postgres、RLS）。本機：IndexedDB（離線暫存、同步佇列、選擇性保留影片）。
- 資料流：選取影片 → 逐幀推論 → 指標 → 只同步壓縮關鍵點、指標、少量關鍵幀截圖。
- `src/analysis/` 是純函式：不可 import React、DOM 相關模組、Supabase、`src/ui`、`src/features`、`src/lib`、`src/pose`（ESLint 會擋）。
- 比賽資料是事件紀錄：每球／每打席一筆事件，統計值即時由事件計算，不儲存統計值。計分引擎在 `src/scoring/`（純函式，同樣不可 import UI／DOM／Supabase）。支援範圍見 `docs/SCORING_SCOPE.md`。
- 所有資料列帶 `player_id`（＝`profiles.id`）與時間戳。
- 資料庫結構只用 `supabase/migrations/*.sql` 管理。
- 每筆動作分析記錄模型版本與分析引擎版本（`ENGINE_VERSION`）。
- 長度用軀幹長正規化，不顯示像素或公分；速度與角度前先濾波（參數寫在 `docs/METRICS.md`）。

## 工作規則（摘自任務書 §9）
- 每個階段：開分支、小步提交、通過 lint／型別檢查／測試／建置、開 PR、更新 `docs/PROGRESS.md`。
- 金鑰與密碼只放環境變數與 GitHub Secrets，絕不寫進程式碼或提交紀錄。
- 分析引擎每個指標都要有單元測試（`tests/fixtures/` 的關鍵點資料）。
- 不提交真人影片或可辨識個人的資料。
- 進度文件明確區分「已寫完」「已通過自動測試」「已在實機確認」；沒實機驗證過不可標示完成。
- 與任務書衝突或沒寫到的重大決定，先問使用者。決定與理由寫進 `docs/DECISIONS.md`。
- 指標公式改變時更新 `docs/METRICS.md`，並調高 `ENGINE_VERSION`。

## 開發指令
- Node 在 `C:/Program Files/nodejs`（Git Bash：`export PATH="/c/Program Files/nodejs:$PATH"`）。
- `npm run dev`：開發伺服器。`npm run check`：lint + 格式 + 型別 + 測試 + 兩個版本的建置（與 CI 相同）。
- `npm run dev:solo`／`npm run build:solo`：對外的單獨分析版（D27），入口 `src/SoloApp.tsx`，以 `SOLO`（`src/lib/edition.ts`）區分；單獨版不可載入 Supabase、球隊功能或標竿動作；單獨版只允許連到自己的網站與 Google 模型下載位置（D28，`vite.config.ts` 的 `SOLO_CSP`），新增外部連線要一起改。
- `npm test`、`npm run typecheck`、`npm run lint`、`npm run format`。
- `node scripts/make-fixtures.mjs`：重新產生 `tests/fixtures/` 的合成關鍵點。
