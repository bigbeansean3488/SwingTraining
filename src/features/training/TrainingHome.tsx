import { useState } from 'react';
import { useAccess } from '../../lib/access';
import { useRows } from '../../lib/hooks';
import { Badge, Card, Empty, LinkButton, ListLink, Page, Tabs } from '../../ui/components';
import { LOG_KIND_LABEL, logSummary } from './trainingInfo';

type Tab = 'logs' | 'sessions';

export function TrainingHome() {
  const access = useAccess();
  const [tab, setTab] = useState<Tab>('logs');
  const [who, setWho] = useState<string>('me');
  const logs = useRows('training_logs');
  const sessions = useRows('training_sessions');
  const profiles = useRows('profiles');
  const name = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? '—';
  const shown = (logs ?? [])
    .filter((l) =>
      who === 'me' ? l.player_id === access.meId : who === 'all' ? true : l.player_id === who,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const byDate = new Map<string, typeof shown>();
  for (const l of shown) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  const players = [...new Set((logs ?? []).map((l) => l.player_id))];

  return (
    <Page title="訓練">
      <div className="grid-2">
        <LinkButton to="/training/log/new?kind=batting">＋ 打擊</LinkButton>
        <LinkButton to="/training/log/new?kind=bullpen">＋ 牛棚</LinkButton>
        <LinkButton to="/training/log/new?kind=fitness" variant="secondary">
          ＋ 體能測驗
        </LinkButton>
        <LinkButton to="/training/log/new?kind=custom" variant="secondary">
          ＋ 自訂項目
        </LinkButton>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'logs', label: '訓練紀錄' },
          { value: 'sessions', label: '訓練課表' },
        ]}
      />
      {tab === 'logs' ? (
        <>
          {access.isStaff ? (
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="球員">
              <option value="me">我的紀錄</option>
              <option value="all">全隊</option>
              {players
                .filter((p) => p !== access.meId)
                .map((p) => (
                  <option key={p} value={p}>
                    {name(p)}
                  </option>
                ))}
            </select>
          ) : null}
          {!shown.length ? (
            <Empty>還沒有訓練紀錄。按上面的按鈕新增。</Empty>
          ) : (
            [...byDate.entries()].map(([date, items]) => (
              <Card
                key={date}
                title={new Date(`${date}T00:00:00`).toLocaleDateString('zh-TW', {
                  month: 'long',
                  day: 'numeric',
                  weekday: 'short',
                })}
              >
                <div className="list">
                  {items.map((l) => (
                    <ListLink
                      key={l.id}
                      to={`/training/log/${l.id}`}
                      title={`${LOG_KIND_LABEL[l.kind]}${who !== 'me' ? `・${name(l.player_id)}` : ''}`}
                      subtitle={logSummary(l)}
                    />
                  ))}
                </div>
              </Card>
            ))
          )}
        </>
      ) : (
        <>
          <LinkButton to="/training/session/new" variant="secondary">
            ＋ 新增課表
          </LinkButton>
          {!(sessions ?? []).length ? (
            <Empty>還沒有課表。教練可以建立全隊課表，球員也可以建立自己的。</Empty>
          ) : (
            <div className="list">
              {[...(sessions ?? [])]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((s) => (
                  <ListLink
                    key={s.id}
                    to={`/training/session/${s.id}`}
                    title={s.title}
                    subtitle={`${s.date}・${s.plan.length} 個項目`}
                    right={s.team_id ? <Badge>全隊</Badge> : <Badge>個人</Badge>}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
