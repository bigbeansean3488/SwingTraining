import { useState } from 'react';
import { acceptInvite, signInWithGoogle, useSession } from '../../lib/auth';
import { navigate } from '../../lib/router';
import { supabaseConfig } from '../../lib/supabase';
import { Button, Card, Notice, Page } from '../../ui/components';

export function JoinPage({ token }: { token: string }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!supabaseConfig()) {
    return (
      <Page title="加入球隊" back="/">
        <Notice kind="error">
          這個網站還沒有設定雲端連線，邀請連結無法使用。請聯絡球隊管理員。
        </Notice>
      </Page>
    );
  }

  async function join() {
    setBusy(true);
    setErr(null);
    try {
      await acceptInvite(token);
      navigate('/more/team', { replace: true });
    } catch (e) {
      const m = (e as Error).message;
      setErr(
        /expired|invalid/.test(m)
          ? '邀請連結已過期或已被使用，請向管理員索取新的連結。'
          : /already linked/.test(m)
            ? '這位名單上的球員已經連結到另一個帳號。'
            : `加入失敗：${m}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="加入球隊" back="/">
      <Card>
        <div className="stack">
          <p style={{ margin: 0 }}>
            你收到一個球隊邀請。
            {session ? `將以 ${session.user.email} 加入。` : '請先用 Google 帳號登入。'}
          </p>
          {session ? (
            <Button onClick={join} disabled={busy}>
              {busy ? '加入中…' : '加入球隊'}
            </Button>
          ) : (
            <Button onClick={() => signInWithGoogle().catch((e: Error) => setErr(e.message))}>
              使用 Google 登入
            </Button>
          )}
          {err ? <Notice kind="error">{err}</Notice> : null}
        </div>
      </Card>
    </Page>
  );
}
