import { useEffect, useState } from 'react';
import { ENGINE_VERSION } from '../../analysis';
import { useAccess } from '../../lib/access';
import { useSession } from '../../lib/auth';
import { clearAllLocal, estimateLocalUsage } from '../../lib/db';
import { ensureMe } from '../../lib/identity';
import { getSupabase, saveDeviceConfig, supabaseConfig } from '../../lib/supabase';
import { Button, Card, Field, Notice, Page } from '../../ui/components';

const DB_LIMIT = 500 * 1024 * 1024;
const STORAGE_LIMIT = 1024 * 1024 * 1024;

interface Usage {
  db_bytes: number;
  storage_bytes: number;
  rows: Record<string, number>;
}

function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span className="mono">
          {(used / 1024 / 1024).toFixed(1)} / {(limit / 1024 / 1024).toFixed(0)} MB（
          {pct.toFixed(0)}%）
        </span>
      </div>
      <div className="progress">
        <div style={{ width: `${pct}%`, background: pct > 80 ? 'var(--error)' : undefined }} />
      </div>
      {pct > 80 ? (
        <Notice kind="warn">
          {label}已用超過 80%，接近免費方案上限。請匯出資料或清理舊的分析。
        </Notice>
      ) : null}
    </div>
  );
}

export function SettingsPage() {
  const cfg = supabaseConfig();
  const session = useSession();
  const access = useAccess();
  const [url, setUrl] = useState(cfg?.source === 'device' ? cfg.url : '');
  const [key, setKey] = useState(cfg?.source === 'device' ? cfg.key : '');
  const [local, setLocal] = useState<{ usage: number | null; quota: number | null } | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    estimateLocalUsage().then(setLocal);
    navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !session || !access.isAdmin) return;
    sb.rpc('db_usage').then(({ data, error }) => {
      if (error) setUsageErr(error.message);
      else setUsage(data as Usage);
    });
  }, [session, access.isAdmin]);

  return (
    <Page title="設定與儲存空間" back="/more">
      <Card title="雲端連線（Supabase）">
        {cfg?.source === 'env' ? (
          <Notice kind="ok">已由網站設定連線：{cfg.url}</Notice>
        ) : (
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>
              建議由管理員在 Cloudflare Pages
              設定環境變數（所有人自動套用）。這裡的設定只存在這支手機，用來測試。
            </p>
            <Field label="Project URL">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value.trim())}
                placeholder="https://xxxx.supabase.co"
              />
            </Field>
            <Field
              label="Publishable key（anon key）"
              hint="只能填 publishable／anon 金鑰，絕對不要填 secret／service_role 金鑰。"
            >
              <input value={key} onChange={(e) => setKey(e.target.value.trim())} />
            </Field>
            <div className="grid-2">
              <Button
                disabled={
                  !url.startsWith('https://') ||
                  key.length < 20 ||
                  /service_role|sb_secret_/.test(key)
                }
                onClick={() => {
                  saveDeviceConfig({ url, key });
                  location.reload();
                }}
              >
                儲存並重新載入
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  saveDeviceConfig(null);
                  location.reload();
                }}
              >
                清除
              </Button>
            </div>
          </div>
        )}
      </Card>

      {session && access.isAdmin ? (
        <Card title="雲端用量（免費方案）">
          {usage ? (
            <div className="stack">
              <Meter used={usage.db_bytes} limit={DB_LIMIT} label="資料庫" />
              <Meter used={usage.storage_bytes} limit={STORAGE_LIMIT} label="檔案（關鍵幀）" />
              <div className="small muted">
                分析 {usage.rows.motion_analyses ?? 0} 筆・比賽事件 {usage.rows.game_events ?? 0}{' '}
                筆・訓練紀錄 {usage.rows.training_logs ?? 0} 筆
              </div>
            </div>
          ) : usageErr ? (
            <Notice kind="warn">無法讀取用量：{usageErr}</Notice>
          ) : (
            <p className="empty">讀取中…</p>
          )}
        </Card>
      ) : null}

      <Card title="這支手機">
        <div className="stack">
          {local?.usage != null ? (
            <div className="small">
              已使用 {(local.usage / 1024 / 1024).toFixed(1)} MB
              {local.quota ? `（可用約 ${(local.quota / 1024 / 1024 / 1024).toFixed(1)} GB）` : ''}
            </div>
          ) : null}
          <div className="small">
            持久儲存：
            {persisted === null ? '—' : persisted ? '已啟用（瀏覽器不會自動清除）' : '未啟用'}
          </div>
          {!persisted && navigator.storage?.persist ? (
            <Button
              variant="secondary"
              onClick={() => navigator.storage.persist().then(setPersisted)}
            >
              要求持久儲存
            </Button>
          ) : null}
          <p className="small muted" style={{ margin: 0 }}>
            iPhone 若超過 7 天沒開啟網站，Safari 可能清除本機資料；加入主畫面並登入同步可避免遺失。
          </p>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('確定清除這支手機上的所有資料？尚未同步的變更會遺失。')) return;
              await clearAllLocal();
              await ensureMe();
              location.hash = '#/';
            }}
          >
            清除這支手機上的資料
          </Button>
        </div>
      </Card>

      <p className="small muted center">
        版本 {__APP_VERSION__}・分析引擎 v{ENGINE_VERSION}・建置{' '}
        {new Date(__BUILD_TIME__).toLocaleString('zh-TW')}
      </p>
    </Page>
  );
}
