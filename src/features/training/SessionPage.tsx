import { useEffect, useState } from 'react';
import { useAccess } from '../../lib/access';
import { deleteRow, getRow, saveRow } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import type { TrainingLogKind, TrainingPlanItem, TrainingSession } from '../../lib/types';
import {
  Button,
  Card,
  Empty,
  Field,
  LinkButton,
  ListLink,
  Notice,
  Page,
} from '../../ui/components';
import { LOG_KIND_LABEL, logSummary } from './trainingInfo';

const today = () => new Date().toLocaleDateString('sv-SE');

export function SessionPage({ id }: { id?: string }) {
  const access = useAccess();
  const [s, setS] = useState<TrainingSession | null>(null);
  const [editing, setEditing] = useState(!id);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const [plan, setPlan] = useState<TrainingPlanItem[]>([
    { kind: 'batting', label: '打擊練習', target: '100 次' },
  ]);
  const [notes, setNotes] = useState('');
  const [teamWide, setTeamWide] = useState(access.isStaff && !!access.teamId);
  const logs = useRows('training_logs', (l) => !!id && l.session_id === id, [id]);
  const profiles = useRows('profiles');

  useEffect(() => {
    if (!id) return;
    getRow('training_sessions', id).then((r) => {
      if (!r) return;
      setS(r);
      setTitle(r.title);
      setDate(r.date);
      setPlan(r.plan);
      setNotes(r.notes ?? '');
      setTeamWide(!!r.team_id);
    });
  }, [id]);

  const canEdit = !s || access.local || (s.team_id ? access.isStaff : true);

  async function save() {
    const row = await saveRow('training_sessions', {
      ...(s ?? {}),
      id: s?.id,
      team_id: teamWide ? access.teamId : null,
      date,
      title: title.trim() || '訓練',
      plan: plan.filter((p) => p.label.trim()),
      notes: notes.trim() || null,
      created_by: s?.created_by ?? null,
    });
    setS(row);
    setEditing(false);
    if (!id) navigate(`/training/session/${row.id}`, { replace: true });
  }

  if (editing) {
    return (
      <Page title={s ? '編輯課表' : '新增課表'} back="/training">
        <Card>
          <div className="stack">
            <Field label="名稱">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如 週三打擊日"
              />
            </Field>
            <Field label="日期">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {access.isStaff && access.teamId ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={teamWide}
                  onChange={(e) => setTeamWide(e.target.checked)}
                />
                全隊課表（隊員都看得到）
              </label>
            ) : null}
            <div className="field-label">項目</div>
            {plan.map((p, i) => (
              <div
                key={i}
                className="stack"
                style={{ gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}
              >
                <div className="grid-2">
                  <select
                    value={p.kind}
                    onChange={(e) =>
                      setPlan(
                        plan.map((x, j) =>
                          j === i ? { ...x, kind: e.target.value as TrainingLogKind } : x,
                        ),
                      )
                    }
                    aria-label="類型"
                  >
                    {(Object.keys(LOG_KIND_LABEL) as TrainingLogKind[]).map((k) => (
                      <option key={k} value={k}>
                        {LOG_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={p.target ?? ''}
                    onChange={(e) =>
                      setPlan(
                        plan.map((x, j) =>
                          j === i ? { ...x, target: e.target.value || null } : x,
                        ),
                      )
                    }
                    placeholder="目標，例如 50 球"
                    aria-label="目標"
                  />
                </div>
                <div className="row">
                  <input
                    className="grow"
                    value={p.label}
                    onChange={(e) =>
                      setPlan(plan.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="項目說明"
                    aria-label="項目說明"
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPlan(plan.filter((_, j) => j !== i))}
                    aria-label="刪除項目"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => setPlan([...plan, { kind: 'custom', label: '', target: null }])}
            >
              ＋ 加一個項目
            </Button>
            <Field label="備註">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button onClick={save}>儲存</Button>
          </div>
        </Card>
      </Page>
    );
  }

  if (!s)
    return (
      <Page title="課表" back="/training">
        <Empty>載入中…</Empty>
      </Page>
    );
  const name = (pid: string) => profiles?.find((p) => p.id === pid)?.display_name ?? '—';

  return (
    <Page title={s.title} back="/training">
      <Card title={`${s.date}・${s.team_id ? '全隊課表' : '個人課表'}`}>
        <div className="stack">
          {s.plan.map((p, i) => (
            <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{LOG_KIND_LABEL[p.kind]}</strong> {p.label}
              </span>
              <span className="muted">{p.target}</span>
            </div>
          ))}
          {s.notes ? <p className="muted">{s.notes}</p> : null}
        </div>
      </Card>
      <Card title="記錄這次訓練">
        <div className="grid-2">
          {[...new Set(s.plan.map((p) => p.kind))].map((k) => (
            <LinkButton
              key={k}
              to={`/training/log/new?kind=${k}&session=${s.id}`}
              variant="secondary"
            >
              ＋ {LOG_KIND_LABEL[k]}
            </LinkButton>
          ))}
        </div>
      </Card>
      <Card title="已記錄">
        {(logs ?? []).length ? (
          <div className="list">
            {(logs ?? []).map((l) => (
              <ListLink
                key={l.id}
                to={`/training/log/${l.id}`}
                title={`${name(l.player_id)}・${LOG_KIND_LABEL[l.kind]}`}
                subtitle={logSummary(l)}
              />
            ))}
          </div>
        ) : (
          <Empty>還沒有人記錄。</Empty>
        )}
      </Card>
      {canEdit ? (
        <div className="grid-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            編輯
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('確定刪除這份課表？已記錄的訓練不會被刪除。')) return;
              await deleteRow('training_sessions', s.id);
              navigate('/training', { replace: true });
            }}
          >
            刪除
          </Button>
        </div>
      ) : (
        <Notice>只有教練可以修改全隊課表。</Notice>
      )}
    </Page>
  );
}
