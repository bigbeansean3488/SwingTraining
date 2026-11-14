import { useEffect, useState } from 'react';
import { useAccess } from '../../lib/access';
import { deleteRow, getRow, saveRow } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import type { AttendanceStatus, CalendarEvent, CalendarKind } from '../../lib/types';
import { Badge, Button, Card, Empty, Field, LinkButton, Notice, Page } from '../../ui/components';
import { EVENT_KIND_LABEL } from './teamInfo';

const STATUS_LABEL: Record<AttendanceStatus, string> = { yes: '會到', no: '請假', maybe: '未定' };

function localInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Tomorrow 18:00 local time. */
function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return localInput(d.toISOString());
}

export function EventForm({ existing }: { existing?: CalendarEvent }) {
  const access = useAccess();
  const seasons = useRows('seasons', (s) => s.team_id === access.teamId, [access.teamId]);
  const [kind, setKind] = useState<CalendarKind>(existing?.kind ?? 'training');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [start, setStart] = useState(
    () => localInput(existing?.starts_at ?? null) || defaultStart(),
  );
  const [end, setEnd] = useState(localInput(existing?.ends_at ?? null));
  const [location, setLocation] = useState(existing?.location ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [season, setSeason] = useState(existing?.season_id ?? '');

  async function save() {
    if (!access.teamId) return;
    const row = await saveRow('events', {
      ...(existing ?? {}),
      id: existing?.id,
      team_id: access.teamId,
      season_id: season || null,
      kind,
      title: title.trim() || EVENT_KIND_LABEL[kind],
      starts_at: new Date(start).toISOString(),
      ends_at: end ? new Date(end).toISOString() : null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      created_by: existing?.created_by ?? null,
    });
    navigate(`/more/calendar/${row.id}`, { replace: true });
  }

  return (
    <Page title={existing ? '編輯行程' : '新增行程'} back="/more/calendar">
      <Card>
        <div className="stack">
          <div className="chips">
            {(Object.keys(EVENT_KIND_LABEL) as CalendarKind[]).map((k) => (
              <button
                key={k}
                className={`btn btn-secondary btn-sm ${kind === k ? 'selected' : ''}`}
                onClick={() => setKind(k)}
              >
                {EVENT_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <Field label="標題">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'game' ? '例如 vs 交大' : '例如 打擊練習'}
            />
          </Field>
          <Field label="開始">
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="結束（選填）">
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="地點">
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          {(seasons ?? []).length ? (
            <Field label="球季">
              <select value={season} onChange={(e) => setSeason(e.target.value)}>
                <option value="">—</option>
                {(seasons ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="備註">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button onClick={save} disabled={!start}>
            儲存
          </Button>
        </div>
      </Card>
    </Page>
  );
}

export function EventPage({ id }: { id: string }) {
  const access = useAccess();
  const [ev, setEv] = useState<CalendarEvent | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const att = useRows('attendance', (a) => a.event_id === id, [id]);
  const members = useRows('team_members', (m) => m.active && m.team_id === ev?.team_id, [
    ev?.team_id,
  ]);
  const profiles = useRows('profiles');
  const games = useRows('games', (g) => g.event_id === id, [id]);
  const [note, setNote] = useState('');

  useEffect(() => {
    getRow('events', id).then((r) => setEv(r ?? null));
  }, [id, editing]);

  const mine = (att ?? [])
    .filter((a) => a.player_id === access.meId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  useEffect(() => setNote(mine?.note ?? ''), [mine?.note]);

  if (ev === undefined)
    return (
      <Page title="行程" back="/more/calendar">
        <Empty>載入中…</Empty>
      </Page>
    );
  if (ev === null)
    return (
      <Page title="行程" back="/more/calendar">
        <Empty>找不到這個行程。</Empty>
      </Page>
    );
  if (editing) return <EventForm existing={ev} />;

  async function answer(status: AttendanceStatus) {
    if (!access.meId || !ev) return;
    await saveRow('attendance', {
      ...(mine ?? {}),
      id: mine?.id,
      event_id: ev.id,
      team_id: ev.team_id,
      player_id: access.meId,
      status,
      note: note.trim() || null,
    });
  }

  const latest = new Map<string, typeof att extends (infer T)[] | null ? T : never>();
  for (const a of [...(att ?? [])].sort((x, y) => x.updated_at.localeCompare(y.updated_at)))
    latest.set(a.player_id, a);
  const name = (pid: string) => profiles?.find((p) => p.id === pid)?.display_name ?? '—';
  const counts = { yes: 0, no: 0, maybe: 0, none: 0 };
  for (const m of members ?? []) {
    const s = latest.get(m.profile_id)?.status;
    counts[s ?? 'none']++;
  }
  const game = (games ?? [])[0];

  return (
    <Page title={ev.title} back="/more/calendar">
      <Card>
        <div className="stack">
          <div>
            <Badge>{EVENT_KIND_LABEL[ev.kind]}</Badge>
          </div>
          <div>
            {new Date(ev.starts_at).toLocaleString('zh-TW', {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
            {ev.ends_at
              ? ` ～ ${new Date(ev.ends_at).toLocaleTimeString('zh-TW', { timeStyle: 'short' })}`
              : ''}
          </div>
          {ev.location ? <div>📍 {ev.location}</div> : null}
          {ev.notes ? <div className="muted">{ev.notes}</div> : null}
        </div>
      </Card>

      {ev.kind === 'game' ? (
        game ? (
          <LinkButton to={`/games/${game.id}`}>打開比賽記錄</LinkButton>
        ) : access.isStaff ? (
          <LinkButton to={`/games/new?event=${ev.id}`}>建立比賽記錄</LinkButton>
        ) : null
      ) : null}

      <Card title="我的出席">
        <div className="stack">
          <div className="grid-3">
            {(Object.keys(STATUS_LABEL) as AttendanceStatus[]).map((s) => (
              <button
                key={s}
                className={`btn btn-secondary ${mine?.status === s ? 'selected' : ''}`}
                onClick={() => answer(s)}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="備註（例如請假原因）"
            onBlur={() => mine && answer(mine.status)}
          />
          {mine ? (
            <p className="small muted" style={{ margin: 0 }}>
              已回覆：{STATUS_LABEL[mine.status]}
            </p>
          ) : null}
        </div>
      </Card>

      {access.isStaff ? (
        <Card
          title={`全隊出席（會到 ${counts.yes}・請假 ${counts.no}・未定 ${counts.maybe}・未回覆 ${counts.none}）`}
        >
          <div className="stack small">
            {(members ?? []).map((m) => {
              const a = latest.get(m.profile_id);
              return (
                <div key={m.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    {name(m.profile_id)}
                    {a?.note ? <span className="muted">・{a.note}</span> : null}
                  </span>
                  {a ? (
                    <Badge kind={a.status === 'yes' ? 'ok' : a.status === 'no' ? 'error' : 'warn'}>
                      {STATUS_LABEL[a.status]}
                    </Badge>
                  ) : (
                    <Badge>未回覆</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Notice>只有教練與管理員看得到全隊的出席回覆。</Notice>
      )}

      {access.isStaff ? (
        <div className="grid-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            編輯
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('確定刪除這個行程？')) return;
              await deleteRow('events', ev.id);
              navigate('/more/calendar', { replace: true });
            }}
          >
            刪除
          </Button>
        </div>
      ) : null}
    </Page>
  );
}
