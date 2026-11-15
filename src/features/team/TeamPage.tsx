import { useState } from 'react';
import { useAccess } from '../../lib/access';
import { useSession } from '../../lib/auth';
import { deleteRow, saveRow, updateRow } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { useMe } from '../../lib/identity';
import { setCurrentTeam, useCurrentTeam } from '../../lib/team';
import type { Invite, Role, TeamMember } from '../../lib/types';
import { Badge, Button, Card, Empty, Field, Notice, Page } from '../../ui/components';
import { inviteUrl, newToken, ROLE_LABEL } from './teamInfo';

export function TeamPage() {
  const me = useMe();
  const team = useCurrentTeam();
  const teams = useRows('teams');
  const access = useAccess();
  const [name, setName] = useState('');

  async function create() {
    if (!me || !name.trim()) return;
    const t = await saveRow('teams', { name: name.trim(), created_by: me.user_id });
    await saveRow('team_members', {
      team_id: t.id,
      profile_id: me.id,
      role: 'admin',
      jersey_number: null,
      positions: null,
      active: true,
    });
    await setCurrentTeam(t.id);
    setName('');
  }

  return (
    <Page title="球隊" back="/more">
      {(teams ?? []).length > 1 ? (
        <Field label="目前球隊">
          <select value={team?.id ?? ''} onChange={(e) => setCurrentTeam(e.target.value)}>
            {(teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {team ? (
        <>
          <Card title={team.name}>
            <div className="row">
              <span>你的角色：</span>
              <Badge kind="ok">
                {access.role ? ROLE_LABEL[access.role] : access.local ? '本機管理' : '—'}
              </Badge>
            </div>
          </Card>
          <Roster teamId={team.id} />
          <Seasons teamId={team.id} />
          <Invites teamId={team.id} />
        </>
      ) : null}

      <Card title={team ? '再建立一支球隊' : '建立球隊'}>
        <div className="stack">
          {!team ? (
            <p style={{ margin: 0 }}>
              還沒有球隊。建立球隊的人會成為管理員；要加入別人的球隊，請向管理員索取邀請連結。
            </p>
          ) : null}
          <Field label="球隊名稱">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="例如 成大棒球隊"
            />
          </Field>
          <Button onClick={create} disabled={!name.trim() || !me}>
            建立
          </Button>
        </div>
      </Card>
    </Page>
  );
}

function Roster({ teamId }: { teamId: string }) {
  const access = useAccess();
  const members = useRows('team_members', (m) => m.team_id === teamId, [teamId]);
  const profiles = useRows('profiles');
  const [editing, setEditing] = useState<string | null>(null);
  const [addId, setAddId] = useState('');
  const name = (pid: string) => profiles?.find((p) => p.id === pid)?.display_name ?? '（未同步）';
  const sorted = [...(members ?? [])].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      (Number(a.jersey_number) || 999) - (Number(b.jersey_number) || 999),
  );
  const notInTeam = (profiles ?? []).filter(
    (p) => !(members ?? []).some((m) => m.profile_id === p.id),
  );

  async function add() {
    if (!addId) return;
    await saveRow('team_members', {
      team_id: teamId,
      profile_id: addId,
      role: 'player',
      jersey_number: null,
      positions: null,
      active: true,
    });
    setAddId('');
  }

  return (
    <Card title={`名單（${sorted.filter((m) => m.active).length} 人）`}>
      {!sorted.length ? <Empty>名單是空的。</Empty> : null}
      <div className="stack">
        {sorted.map((m) =>
          editing === m.id ? (
            <MemberEditor
              key={m.id}
              m={m}
              name={name(m.profile_id)}
              onDone={() => setEditing(null)}
              canSetRole={access.isAdmin}
            />
          ) : (
            <div
              key={m.id}
              className="row"
              style={{ justifyContent: 'space-between', opacity: m.active ? 1 : 0.5 }}
            >
              <div>
                <div className="list-title">
                  {m.jersey_number ? `#${m.jersey_number} ` : ''}
                  {name(m.profile_id)}
                </div>
                <div className="small muted">
                  {ROLE_LABEL[m.role]}
                  {m.positions ? `・${m.positions}` : ''}
                  {m.active ? '' : '・已離隊'}
                </div>
              </div>
              {access.isAdmin || (access.isStaff && m.role === 'player') ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(m.id)}>
                  編輯
                </button>
              ) : null}
            </div>
          ),
        )}
        {access.isStaff && notInTeam.length ? (
          <div className="row">
            <select
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              style={{ flex: 1 }}
              aria-label="加入名單"
            >
              <option value="">把已建立的球員加入名單…</option>
              {notInTeam.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <Button className="btn-sm" onClick={add} disabled={!addId}>
              加入
            </Button>
          </div>
        ) : null}
        <p className="small muted" style={{ margin: 0 }}>
          新增沒有帳號的球員請到「更多 → 球員」。
        </p>
      </div>
    </Card>
  );
}

function MemberEditor({
  m,
  name,
  onDone,
  canSetRole,
}: {
  m: TeamMember;
  name: string;
  onDone: () => void;
  canSetRole: boolean;
}) {
  const [f, setF] = useState(m);
  async function save() {
    await updateRow('team_members', m.id, {
      role: f.role,
      jersey_number: f.jersey_number?.trim() || null,
      positions: f.positions?.trim() || null,
      active: f.active,
    });
    onDone();
  }
  return (
    <div className="stack card" style={{ padding: 12 }}>
      <div className="list-title">{name}</div>
      <div className="grid-2">
        <Field label="背號">
          <input
            value={f.jersey_number ?? ''}
            onChange={(e) => setF({ ...f, jersey_number: e.target.value })}
            inputMode="numeric"
          />
        </Field>
        <Field label="角色">
          <select
            value={f.role}
            onChange={(e) => setF({ ...f, role: e.target.value as Role })}
            disabled={!canSetRole}
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="守備位置">
        <input
          value={f.positions ?? ''}
          onChange={(e) => setF({ ...f, positions: e.target.value })}
          placeholder="例如 SS, 2B"
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={f.active}
          onChange={(e) => setF({ ...f, active: e.target.checked })}
        />
        在隊上
      </label>
      <div className="grid-2">
        <Button onClick={save}>儲存</Button>
        <Button variant="secondary" onClick={onDone}>
          取消
        </Button>
      </div>
    </div>
  );
}

function Seasons({ teamId }: { teamId: string }) {
  const access = useAccess();
  const seasons = useRows('seasons', (s) => s.team_id === teamId, [teamId]);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  async function add() {
    await saveRow('seasons', {
      team_id: teamId,
      name: name.trim(),
      starts_on: start || null,
      ends_on: end || null,
    });
    setName('');
    setStart('');
    setEnd('');
  }
  return (
    <Card title="球季">
      <div className="stack">
        {[...(seasons ?? [])]
          .sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? ''))
          .map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{s.name}</strong>{' '}
                <span className="small muted">
                  {s.starts_on ?? '?'} ～ {s.ends_on ?? '?'}
                </span>
              </span>
              {access.isStaff ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => confirm('刪除這個球季？') && deleteRow('seasons', s.id)}
                >
                  刪除
                </button>
              ) : null}
            </div>
          ))}
        {!(seasons ?? []).length ? <Empty>還沒有球季。</Empty> : null}
        {access.isStaff ? (
          <>
            <Field label="新增球季">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 2027 大專聯賽"
              />
            </Field>
            <div className="grid-2">
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-label="開始日期"
              />
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-label="結束日期"
              />
            </div>
            <Button variant="secondary" onClick={add} disabled={!name.trim()}>
              新增球季
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}

function Invites({ teamId }: { teamId: string }) {
  const access = useAccess();
  const session = useSession();
  const invites = useRows(
    'invites',
    (i) => i.team_id === teamId && !i.used_at && i.expires_at > new Date().toISOString(),
    [teamId],
  );
  const profiles = useRows('profiles');
  const members = useRows('team_members', (m) => m.team_id === teamId, [teamId]);
  const [role, setRole] = useState<Role>('player');
  const [claim, setClaim] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  if (!access.isStaff) return null;
  const unlinked = (profiles ?? []).filter(
    (p) => !p.user_id && (members ?? []).some((m) => m.profile_id === p.id),
  );
  const name = (pid: string | null) =>
    pid ? (profiles?.find((p) => p.id === pid)?.display_name ?? '—') : null;

  async function create() {
    const expires = new Date(Date.now() + (claim ? 14 : 7) * 86400000).toISOString();
    await saveRow('invites', {
      team_id: teamId,
      token: newToken(),
      role,
      profile_id: claim || null,
      expires_at: expires,
      used_at: null,
      created_by: null,
    });
    setClaim('');
  }

  async function share(inv: Invite) {
    const url = inviteUrl(inv.token);
    const text = `加入球隊（${ROLE_LABEL[inv.role]}${inv.profile_id ? `：${name(inv.profile_id)}` : ''}）`;
    try {
      if (navigator.share) await navigator.share({ title: text, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(inv.id);
      }
    } catch {
      // share sheet dismissed
    }
  }

  return (
    <Card title="邀請連結">
      <div className="stack">
        {!session ? (
          <Notice kind="warn">邀請需要雲端帳號：請先在「帳號與同步」登入，連結才會生效。</Notice>
        ) : null}
        <div className="grid-2">
          <Field label="角色">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="player">球員</option>
              {access.isAdmin ? <option value="coach">教練</option> : null}
              {access.isAdmin ? <option value="admin">管理員</option> : null}
            </select>
          </Field>
          <Field label="認領名單上的球員（選填）">
            <select value={claim} onChange={(e) => setClaim(e.target.value)}>
              <option value="">不指定（新成員）</option>
              {unlinked.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button onClick={create}>產生邀請連結</Button>
        <p className="small muted" style={{ margin: 0 }}>
          不指定球員的連結 7 天內可多人使用；指定球員的連結只能用一次（14
          天有效），對方的訓練與分析資料會合併到名單上的這位球員。
        </p>
        {(invites ?? []).map((inv) => (
          <div key={inv.id} className="card stack" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <Badge>{ROLE_LABEL[inv.role]}</Badge> {name(inv.profile_id) ?? '新成員'}
              </span>
              <span className="small muted">
                到期 {new Date(inv.expires_at).toLocaleDateString('zh-TW')}
              </span>
            </div>
            <code className="small" style={{ wordBreak: 'break-all' }}>
              {inviteUrl(inv.token)}
            </code>
            <div className="grid-2">
              <Button className="btn-sm" onClick={() => share(inv)}>
                {copied === inv.id ? '已複製' : '分享／複製'}
              </Button>
              <Button
                className="btn-sm"
                variant="secondary"
                onClick={() => deleteRow('invites', inv.id)}
              >
                作廢
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
