// 更多 page of the stand-alone analysis app: name, backup and transfer, where
// data lives, and sources/licenses.
import { useEffect, useState } from 'react';
import { ENGINE_VERSION } from '../../analysis';
import { REFERENCE_SOURCE } from '../../analysis/researchSample';
import { makeBackup, parseBackup, restoreBackup, type BackupFile } from '../../lib/backup';
import { clearAllLocal, saveRow } from '../../lib/db';
import { downloadText } from '../../lib/download';
import { ensureMe, useMe } from '../../lib/identity';
import { formatDateTime } from '../../lib/analysisTime';
import { Button, Card, Field, LinkButton, Notice, Page } from '../../ui/components';
import { DISCLAIMER } from '../analyze/metricInfo';

export function SoloMorePage() {
  return (
    <Page title="更多">
      <NameCard />
      <BackupCard />
      <StorageCard />
      <AboutCard />
      <LinkButton to="/analyze/diagnostics" variant="ghost">
        診斷與效能（技術資訊）
      </LinkButton>
      <ClearCard />
    </Page>
  );
}

function NameCard() {
  const me = useMe();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (me) setName(me.display_name);
  }, [me]);
  const dirty = !!me && name.trim() !== '' && name.trim() !== me.display_name;
  return (
    <Card title="你的名字">
      <Field label="顯示名稱" hint="只存在這支手機。備份檔會帶著這個名字，方便別人知道是誰的動作。">
        <input
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
      </Field>
      <Button
        disabled={!dirty}
        onClick={async () => {
          if (!me) return;
          await saveRow('profiles', { ...me, display_name: name.trim() });
          setSaved(true);
        }}
      >
        儲存
      </Button>
      {saved ? <Notice kind="ok">已儲存。</Notice> : null}
    </Card>
  );
}

function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [asMine, setAsMine] = useState(true);

  async function exportNow() {
    setBusy(true);
    setMsg(null);
    try {
      const b = await makeBackup(__APP_VERSION__);
      downloadText(
        `動作分析備份-${b.exported_at.slice(0, 10)}.json`,
        JSON.stringify(b),
        'application/json',
      );
      setMsg({ kind: 'ok', text: `已匯出 ${b.motion_analyses.length} 筆分析。` });
    } catch (e) {
      setMsg({ kind: 'error', text: `匯出失敗：${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File) {
    setMsg(null);
    setPending(null);
    try {
      const b = parseBackup(JSON.parse(await file.text()));
      if (!b) setMsg({ kind: 'error', text: '這不是本 App 的備份檔。' });
      else {
        setPending(b);
        setAsMine(true);
      }
    } catch {
      setMsg({ kind: 'error', text: '檔案讀不出來，請確認是本 App 匯出的 .json 備份檔。' });
    }
  }

  async function importNow() {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await restoreBackup(pending, { asMine });
      setPending(null);
      setMsg({
        kind: 'ok',
        text:
          `已匯入 ${r.analyses} 筆分析` +
          (r.skipped ? `；${r.skipped} 筆這支手機已經有，保留原本的` : '') +
          '。',
      });
    } catch (e) {
      setMsg({ kind: 'error', text: `匯入失敗：${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const owner = pending?.profiles.find((p) => p.id === pending.me_profile_id)?.display_name;
  return (
    <Card title="備份與轉移">
      <p className="small muted" style={{ marginTop: 0 }}>
        備份檔包含分析結果、骨架關鍵點與關鍵幀截圖，<strong>不含原始影片</strong>
        。可以用來換手機，或傳給教練、隊友匯入查看。
      </p>
      <div className="stack">
        <Button onClick={exportNow} disabled={busy}>
          匯出備份檔
        </Button>
        <label className="btn btn-secondary btn-block">
          匯入備份檔
          <input
            type="file"
            accept="application/json,.json"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void pick(f);
            }}
          />
        </label>
      </div>
      {pending ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <Notice>
            {owner ? `「${owner}」的備份，` : ''}
            {pending.motion_analyses.length} 筆分析，匯出時間 {formatDateTime(pending.exported_at)}
            。
          </Notice>
          <label className="check">
            <input type="checkbox" checked={asMine} onChange={(e) => setAsMine(e.target.checked)} />
            這是我自己的備份（併入我的紀錄，例如換手機）
          </label>
          <p className="small muted" style={{ margin: 0 }}>
            不勾選：當成另一個人的紀錄分開保存，不會跟你的歷史互相比較。
          </p>
          <div className="grid-2">
            <Button onClick={importNow} disabled={busy}>
              匯入
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    </Card>
  );
}

function StorageCard() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted);
  }, []);
  return (
    <Card title="資料存在哪裡">
      <p style={{ marginTop: 0 }}>
        影片在這支手機上分析，<strong>影片、骨架和分析結果都不會上傳</strong>
        。結果只存在這個瀏覽器裡，沒有帳號，也不會同步到其他裝置。
      </p>
      <p className="small muted">
        這個網頁只會連到自己的網站和 Google
        的模型下載位置（第一次分析時下載骨架辨識模型）。骨架辨識元件（Google
        MediaPipe）原本會定期把執行統計傳給 Google，這個版本已經擋掉。
      </p>
      <p>
        清除瀏覽器資料、刪除主畫面上的 App，或 iPhone 長時間沒打開，資料都可能被刪掉。
        <strong>請把網頁「加入主畫面」，並定期匯出備份檔。</strong>
      </p>
      {persisted === false && navigator.storage?.persist ? (
        <Button
          variant="secondary"
          onClick={async () => setPersisted(await navigator.storage.persist())}
        >
          請瀏覽器保留資料
        </Button>
      ) : persisted ? (
        <p className="small muted" style={{ marginBottom: 0 }}>
          瀏覽器已同意保留這個 App 的資料。
        </p>
      ) : null}
    </Card>
  );
}

function AboutCard() {
  return (
    <Card title="關於與授權">
      <p style={{ marginTop: 0 }}>{DISCLAIMER}</p>
      <p className="small">
        骨架辨識：Google MediaPipe Pose Landmarker（Apache 2.0），模型第一次使用時從 Google
        下載，之後可離線使用。
      </p>
      <p className="small">
        研究樣本比較：
        <a href={REFERENCE_SOURCE.url} target="_blank" rel="noreferrer">
          {REFERENCE_SOURCE.name}
        </a>
        （{REFERENCE_SOURCE.author}），
        <a href={REFERENCE_SOURCE.licenseUrl} target="_blank" rel="noreferrer">
          {REFERENCE_SOURCE.license}
        </a>
        。本 App 已轉換資料並重新計算指標，Driveline
        未參與也未背書。依該授權，這部分只可非商業使用；
        職業運動組織或金融分析公司的員工、約聘人員或大股東不得使用。
      </p>
      <p className="small muted" style={{ marginBottom: 0 }}>
        App {__APP_VERSION__}・分析引擎 {ENGINE_VERSION}・免費、非商業
      </p>
    </Card>
  );
}

function ClearCard() {
  const [done, setDone] = useState(false);
  return (
    <Card title="清除資料">
      <p className="small muted" style={{ marginTop: 0 }}>
        刪除這支手機上的所有分析紀錄、保留的影片和設定。無法復原，建議先匯出備份。
      </p>
      <Button
        variant="danger"
        onClick={async () => {
          if (!window.confirm('確定要刪除這支手機上的所有分析紀錄嗎？刪除後無法復原。')) return;
          await clearAllLocal();
          await ensureMe();
          setDone(true);
        }}
      >
        清除所有資料
      </Button>
      {done ? <Notice kind="ok">已清除。</Notice> : null}
    </Card>
  );
}
