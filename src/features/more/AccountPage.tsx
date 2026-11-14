import { useState } from 'react';
import { signInWithGoogle, signOut, useSession } from '../../lib/auth';
import { setMeta } from '../../lib/db';
import { useMeta, useOutboxCount } from '../../lib/hooks';
import { useMe } from '../../lib/identity';
import { supabaseConfig } from '../../lib/supabase';
import { requestSync, type SyncError } from '../../lib/sync';
import { Badge, Button, Card, LinkButton, Notice, Page } from '../../ui/components';
import { syncLabel, useSyncStatus } from './syncStatus';

export function AccountPage() {
  const session = useSession();
  const me = useMe();
  const cfg = supabaseConfig();
  const pending = useOutboxCount();
  const sync = useSyncStatus();
  const errors = useMeta<SyncError[]>('sync_errors') ?? [];
  const [clear, setClear] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  if (!cfg) {
    return (
      <Page title="帳號與同步" back="/more">
        <Notice>
          <strong>本機模式</strong>
          ：所有功能都能用，但資料只存在這支手機。要讓全隊共用資料，管理員需要先設定
          Supabase（免費）。
        </Notice>
        <LinkButton to="/more/settings">前往連線設定</LinkButton>
      </Page>
    );
  }

  if (!session) {
    return (
      <Page title="帳號與同步" back="/more">
        <Card title="登入">
          <div className="stack">
            <p style={{ margin: 0 }}>
              用 Google 帳號登入（學校的 Google 帳號也可以）。登入後，這支手機上的資料會同步到雲端。
            </p>
            <Button
              onClick={() =>
                signInWithGoogle().catch((e: Error) => setErr(`登入失敗：${e.message}`))
              }
            >
              使用 Google 登入
            </Button>
            {err ? <Notice kind="error">{err}</Notice> : null}
            <p className="small muted" style={{ margin: 0 }}>
              iPhone 若從主畫面開啟時登入失敗，請改用 Safari 開啟網址登入，並回報這個狀況。
            </p>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="帳號與同步" back="/more">
      <Card title="帳號">
        <div className="stack">
          <div>{session.user.email}</div>
          <div className="muted small">球員檔案：{me?.display_name ?? '—'}</div>
        </div>
      </Card>
      <Card title="同步">
        <div className="stack">
          <div className="row">
            <Badge kind={sync.state === 'idle' ? 'ok' : sync.state === 'error' ? 'error' : 'warn'}>
              {syncLabel(sync.state)}
            </Badge>
            {pending ? (
              <Badge kind="warn">{pending} 筆待同步</Badge>
            ) : (
              <Badge>沒有待同步的變更</Badge>
            )}
          </div>
          {sync.lastSyncAt ? (
            <div className="small muted">
              上次同步：{new Date(sync.lastSyncAt).toLocaleString('zh-TW')}
            </div>
          ) : null}
          {sync.lastError ? <Notice kind="warn">{sync.lastError}</Notice> : null}
          <Button variant="secondary" onClick={() => requestSync()}>
            立即同步
          </Button>
          <p className="small muted" style={{ margin: 0 }}>
            離線時的變更會先存在手機，恢復連線後自動上傳。兩支手機同時改同一筆資料時，以
            <strong>最後修改的時間</strong>為準。
          </p>
        </div>
      </Card>
      {errors.length ? (
        <Card title="被伺服器拒絕的變更">
          <div className="stack small">
            <p style={{ margin: 0 }}>
              通常是權限不足（例如球員修改了只有教練能改的資料）。這些變更只留在這支手機。
            </p>
            {errors.slice(0, 10).map((e, i) => (
              <div key={i} className="mono">
                {new Date(e.at).toLocaleString('zh-TW')}・{e.table}・{e.message}
              </div>
            ))}
            <Button variant="ghost" className="btn-sm" onClick={() => setMeta('sync_errors', [])}>
              清除紀錄
            </Button>
          </div>
        </Card>
      ) : null}
      <Card title="登出">
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            同時清除這支手機上的資料（共用手機請勾選）
          </label>
          {pending && clear ? (
            <Notice kind="warn">還有 {pending} 筆變更沒同步，清除後會遺失。</Notice>
          ) : null}
          <Button variant="danger" onClick={() => signOut(clear)}>
            登出
          </Button>
        </div>
      </Card>
    </Page>
  );
}
