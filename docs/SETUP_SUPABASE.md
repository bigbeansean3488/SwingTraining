# 設定 Supabase、Google 登入、保活與備份（需要你本人操作）

全部使用免費方案。**任何畫面要求信用卡或升級付費方案時，停下來不要填，先回報。**
預計 30～45 分鐘。做完請回報最下面「做完要回報什麼」。

> 沒做這些步驟時，App 以「本機模式」運作：所有功能都能用，資料只存在單一手機。

## A. 建立 Supabase 專案

1. 到 <https://supabase.com/dashboard> 用 GitHub 帳號登入（免費）。
2. **New project**：
   - Organization：用預設的個人組織，方案選 **Free**。
   - Project name：例如 `team-platform`。
   - Database password：按 Generate 產生一組，**存進密碼管理器**（備份要用）。
   - Region：**Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**（離台灣近）。
3. 等專案建立完成（約 2 分鐘）。

## B. 建立資料表與權限

1. 左側選單 **SQL Editor** → **New query**。
2. 打開儲存庫的 [`supabase/migrations/20261114000000_init.sql`](../supabase/migrations/20261114000000_init.sql)，全選複製，貼進編輯器。
3. 按 **Run**。應該看到「Success. No rows returned」。
   - 如果出現錯誤，把整段錯誤訊息截圖回報，不要自行修改 SQL。
4. `supabase/migrations/` 裡**之後新增的檔案**，依檔名順序一個一個照同樣方式執行（新建專案時全部依序執行即可）：
   - [`20261115000000_marked_good.sql`](../supabase/migrations/20261115000000_marked_good.sql)：「標記為好的動作」欄位。**已經照舊版步驟建好資料表的專案也要補執行這一個**，否則有標記的分析會同步失敗。
   - [`20261117000000_reference_motions.sql`](../supabase/migrations/20261117000000_reference_motions.sql)：「標竿動作」資料表。沒執行時，標竿只會留在建立的那支手機上（「帳號與同步」頁會提示缺少資料表），其他資料照常同步。

## C. 取得連線資訊

左側 **Project Settings** → **API Keys**（或 **Data API**）：

- **Project URL**：`https://xxxxxxxx.supabase.co`
- **Publishable key**：`sb_publishable_...`（舊版介面叫 `anon` `public` key）

這兩個可以公開給瀏覽器使用（資料由列級權限保護）。
**絕對不要**把 `secret` / `service_role` 金鑰貼到 App、Cloudflare 或程式碼裡。

## D. 設定 Google 登入

為什麼用 Google 而不是 Email 魔術連結：Supabase 免費方案內建的寄信服務只能寄給專案成員、每小時約 2 封，要讓全隊用魔術連結必須另外申請寄信服務（SMTP）。學校帳號本身就是 Google 帳號，用 Google 登入不需要額外服務。（詳見 `docs/DECISIONS.md` D13）

1. 用**個人 Google 帳號**打開 <https://console.cloud.google.com>（學校帳號可能沒有建立專案的權限）。
   如果要求啟用帳單（billing），**停下來回報**；建立 OAuth 用戶端不需要帳單。
2. 上方專案選單 → **New project** → 名稱 `team-platform` → Create，並切換到這個專案。
3. 左側 **APIs & Services** → **OAuth consent screen**（新版介面叫 **Google Auth Platform**）→ Get started：
   - App name：`球隊訓練`；User support email：你的信箱。
   - Audience：**External**。
   - Contact information：你的信箱 → 同意條款 → Create。
4. **Audience**（或 Publishing status）→ **Publish app**（改成 In production）。
   只使用基本的 email／profile 權限，不需要 Google 審核。若選擇維持 Testing，就要把每位隊員的 Gmail 加到 Test users（上限 100 人）。
5. **Clients** → **Create client**：
   - Application type：**Web application**，名稱 `supabase`。
   - Authorized JavaScript origins：`https://<你的專案名>.pages.dev`
   - Authorized redirect URIs：`https://<你的 Supabase 專案代碼>.supabase.co/auth/v1/callback`
     （Supabase 的 Google provider 設定頁會直接顯示這個 Callback URL，可以複製過來）
   - Create，複製 **Client ID** 與 **Client secret**。
6. 回到 Supabase：**Authentication** → **Sign In / Providers** → **Google** → 開啟，貼上 Client ID 與 Client secret → Save。
7. Supabase：**Authentication** → **URL Configuration**：
   - Site URL：`https://<你的專案名>.pages.dev`
   - Redirect URLs：新增 `https://<你的專案名>.pages.dev/**`（開發時再加 `http://localhost:5173/**`）。

## E. 讓網站連到 Supabase（Cloudflare Pages）

1. Cloudflare → **Workers & Pages** → 你的專案 → **Settings** → **Variables and Secrets**。
2. 在 **Production** 新增兩個變數（類型選 Text）：
   - `VITE_SUPABASE_URL` ＝ Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` ＝ Publishable key
3. **Deployments** → 最新一筆 → **Retry deployment**（變數在建置時寫入，要重新部署才會生效）。

## F. GitHub Secrets（保活與備份）

GitHub 儲存庫 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，新增：

| 名稱 | 內容 |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key |
| `SUPABASE_DB_URL` | Supabase → 上方 **Connect** → **Session pooler** 的連線字串（`postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres`），把 `[YOUR-PASSWORD]` 換成 A-2 的資料庫密碼。**要用 Session pooler**：GitHub 的機器不支援 IPv6，直接連線（Direct connection）會失敗。 |
| `BACKUP_PASSPHRASE` | 自己產生一組 30 字以上的隨機密碼，**存進密碼管理器**。沒有它就無法還原備份。 |

設定完到 **Actions** 分頁：
1. 點 **Keep Supabase awake** → **Run workflow**，確認綠色勾勾。
2. 點 **Weekly database backup** → **Run workflow**，完成後在該次執行頁面下方的 **Artifacts** 應該看到 `db-backup-...`。

### 備份存放位置（為什麼這樣做）
- 備份會用 `BACKUP_PASSPHRASE` 以 AES-256 加密後，存成 GitHub Actions 的 **artifact**，保留 90 天。
- 這個儲存庫是公開的，登入 GitHub 的人可能看得到 artifact，所以**只存加密檔**，從不存未加密的備份；工作紀錄（log）也不會印出任何資料。
- 想保存更久（選用）：建立一個**私有**儲存庫（例如 `team-backups`），建立只對該儲存庫有 Contents 讀寫權限的 fine-grained token，再新增兩個 secret：`BACKUP_REPO`（`你的帳號/team-backups`）與 `BACKUP_REPO_TOKEN`。備份會同時推到那裡並保留最近 26 份（約半年）。
- 免費替代方案比較：Cloudflare R2 需要綁付款方式、Google Drive 需要另外設定服務帳號，因此不採用。

### 還原備份
```bash
gpg -d db-backup-20261115.tgz.gpg > backup.tgz     # 輸入 BACKUP_PASSPHRASE
mkdir restore && tar xzf backup.tgz -C restore
pg_restore --no-owner --no-privileges -d "<新的 Postgres 連線字串>" restore/public.dump
```
`auth_users.csv` 是帳號與 Email 的對照表（含個資，請妥善保管）。

### 注意：GitHub 排程的 60 天規則
公開儲存庫超過 60 天沒有任何提交時，GitHub 會自動停用排程工作。保活工作每天會呼叫 GitHub API 重新啟用自己與備份工作，應該可以避免；但這點**尚未實際驗證**。如果收到 GitHub 寄來「scheduled workflow disabled」的信，到 Actions 分頁按 Enable workflow 即可。

## G. 第一次使用

1. 手機打開網站 → **更多** → **帳號與同步** → **使用 Google 登入**。
2. **更多** → **球隊** → 建立球隊（建立者就是管理員）。
3. 在球隊頁產生邀請連結傳給教練與球員。

## 驗收：兩支手機
1. 手機 A（教練帳號）建立球隊，產生「球員」邀請連結。
2. 手機 B（另一個 Google 帳號）打開連結 → 登入 → 加入球隊，做一次打擊分析。
3. 手機 A 的 **更多 → 球員** 應該看得到 B 的分析；手機 B 看不到其他球員的分析與訓練紀錄。

## 做完要回報什麼
- Cloudflare Pages 網址、Supabase Project URL（**不要**回報任何金鑰或密碼）。
- iPhone：從 **Safari** 登入是否成功；從**主畫面圖示**開啟時登入是否成功。
- Android：登入是否成功。
- Actions 兩個工作是否都是綠色勾勾、Artifacts 是否出現。
- 兩支手機驗收的結果（截圖更好）。
