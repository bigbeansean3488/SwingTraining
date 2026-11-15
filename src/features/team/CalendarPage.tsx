import { useMemo, useState } from 'react';
import { useAccess } from '../../lib/access';
import { useRows } from '../../lib/hooks';
import type { CalendarEvent } from '../../lib/types';
import { EVENT_KIND_LABEL } from './teamInfo';
import { Badge, Empty, LinkButton, ListLink, Page } from '../../ui/components';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function ymd(d: Date) {
  return d.toLocaleDateString('sv-SE');
}

export function CalendarPage() {
  const access = useAccess();
  const events = useRows('events', (e) => e.team_id === access.teamId, [access.teamId]);
  const myAtt = useRows('attendance', (a) => a.player_id === access.meId, [access.meId]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [day, setDay] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const k = ymd(new Date(e.starts_at));
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [events]);

  const cells: (Date | null)[] = [];
  const first = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));

  const now = new Date().toISOString();
  const list = [...(events ?? [])]
    .filter((e) => (day ? ymd(new Date(e.starts_at)) === day : e.starts_at >= now.slice(0, 10)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, day ? 50 : 15);
  const reply = (id: string) => myAtt?.find((a) => a.event_id === id)?.status;

  if (!access.teamId) {
    return (
      <Page title="行事曆" back="/more">
        <Empty>請先在「球隊」建立或加入球隊。</Empty>
      </Page>
    );
  }

  return (
    <Page title="行事曆" back="/more">
      {access.isStaff ? <LinkButton to="/more/calendar/new">＋ 新增行程</LinkButton> : null}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="上個月"
          >
            ‹
          </button>
          <strong>
            {month.getFullYear()} 年 {month.getMonth() + 1} 月
          </strong>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="下個月"
          >
            ›
          </button>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 4,
            textAlign: 'center',
          }}
        >
          {WEEK.map((w) => (
            <div key={w} className="small muted">
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const k = ymd(d);
            const evs = byDay.get(k) ?? [];
            const sel = day === k;
            const today = k === ymd(new Date());
            return (
              <button
                key={i}
                onClick={() => setDay(sel ? null : k)}
                style={{
                  minHeight: 44,
                  borderRadius: 10,
                  border: sel
                    ? '2px solid var(--brand)'
                    : today
                      ? '2px solid var(--line)'
                      : '2px solid transparent',
                  background: evs.length ? 'var(--surface-2)' : 'transparent',
                  color: 'var(--text)',
                  font: 'inherit',
                  padding: 2,
                }}
                aria-label={`${d.getMonth() + 1}月${d.getDate()}日，${evs.length} 個行程`}
              >
                <div>{d.getDate()}</div>
                <div style={{ fontSize: 10, lineHeight: 1 }}>
                  {evs
                    .map((e) => (e.kind === 'game' ? '⚾' : e.kind === 'training' ? '●' : '○'))
                    .join('')}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <h2 style={{ fontSize: 18 }}>{day ? `${day} 的行程` : '接下來的行程'}</h2>
      {list.length ? (
        <div className="list">
          {list.map((e) => {
            const r = reply(e.id);
            return (
              <ListLink
                key={e.id}
                to={`/more/calendar/${e.id}`}
                title={`${EVENT_KIND_LABEL[e.kind]}・${e.title}`}
                subtitle={`${new Date(e.starts_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}${e.location ? `・${e.location}` : ''}`}
                right={
                  r ? (
                    <Badge kind={r === 'yes' ? 'ok' : r === 'no' ? 'error' : 'warn'}>
                      {r === 'yes' ? '會到' : r === 'no' ? '請假' : '未定'}
                    </Badge>
                  ) : (
                    <Badge>未回覆</Badge>
                  )
                }
              />
            );
          })}
        </div>
      ) : (
        <Empty>沒有行程。</Empty>
      )}
    </Page>
  );
}
