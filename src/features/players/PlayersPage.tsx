import { useState } from 'react';
import { useAccess } from '../../lib/access';
import { saveRow } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import { Button, Card, Empty, Field, ListLink, Page } from '../../ui/components';

export function PlayersPage() {
  const access = useAccess();
  const profiles = useRows('profiles');
  const members = useRows('team_members', (m) => m.active, []);
  const [name, setName] = useState('');
  const teamMembers = (members ?? []).filter((m) => m.team_id === access.teamId);
  const inTeam = new Set(teamMembers.map((m) => m.profile_id));
  const list = (profiles ?? [])
    .filter((p) => !access.teamId || inTeam.has(p.id) || p.id === access.meId)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh-Hant'));
  const member = (pid: string) => teamMembers.find((m) => m.profile_id === pid);

  async function add() {
    if (!name.trim()) return;
    const p = await saveRow('profiles', {
      user_id: null,
      display_name: name.trim(),
      height_cm: null,
      bats: null,
      throws: null,
      birth_year: null,
      notes: null,
      created_by: null,
    });
    if (access.teamId) {
      await saveRow('team_members', {
        team_id: access.teamId,
        profile_id: p.id,
        role: 'player',
        jersey_number: null,
        positions: null,
        active: true,
      });
    }
    setName('');
    navigate(`/more/players/${p.id}`);
  }

  return (
    <Page title="球員" back="/more">
      {profiles === null ? (
        <Empty>載入中…</Empty>
      ) : list.length === 0 ? (
        <Empty>還沒有球員。</Empty>
      ) : (
        <div className="list">
          {list.map((p) => {
            const m = member(p.id);
            return (
              <ListLink
                key={p.id}
                to={`/more/players/${p.id}`}
                title={`${m?.jersey_number ? `#${m.jersey_number} ` : ''}${p.display_name}${p.id === access.meId ? '（我）' : ''}`}
                subtitle={[m?.positions, p.user_id ? '已連結帳號' : '未連結帳號']
                  .filter(Boolean)
                  .join('・')}
              />
            );
          })}
        </div>
      )}
      {access.isStaff ? (
        <Card title="新增球員">
          <div className="stack">
            <Field label="姓名" hint="沒有帳號的球員也可以先建立，之後用邀請連結讓本人認領。">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <Button onClick={add} disabled={!name.trim()}>
              新增
            </Button>
          </div>
        </Card>
      ) : null}
    </Page>
  );
}
