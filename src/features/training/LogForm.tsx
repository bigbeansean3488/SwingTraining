import { useEffect, useState } from 'react';
import { useAccess } from '../../lib/access';
import { deleteRow, getRow, saveRow } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import type { TrainingLog, TrainingLogData, TrainingLogKind } from '../../lib/types';
import { Button, Card, Field, Notice, Page, Tabs } from '../../ui/components';
import { FITNESS_PRESETS, LOG_KIND_LABEL, PITCH_TYPES, pitchTotal } from './trainingInfo';

const today = () => new Date().toLocaleDateString('sv-SE');

function Stepper({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onChange(Math.max(0, value - step))}
        aria-label="減少"
      >
        −
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))}
        style={{ textAlign: 'center', minWidth: 64 }}
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onChange(value + step)}
        aria-label="增加"
      >
        ＋
      </button>
    </div>
  );
}

export function LogForm({
  id,
  initialKind,
  sessionId,
}: {
  id?: string;
  initialKind?: TrainingLogKind;
  sessionId?: string | null;
}) {
  const access = useAccess();
  const profiles = useRows('profiles');
  const members = useRows('team_members', (m) => m.active, []);
  const [loaded, setLoaded] = useState(!id);
  const [kind, setKind] = useState<TrainingLogKind>(initialKind ?? 'batting');
  const [playerId, setPlayerId] = useState('');
  const [date, setDate] = useState(today());
  const [data, setData] = useState<TrainingLogData>({ swings: 0, pitches: {} });
  const [note, setNote] = useState('');
  const [existing, setExisting] = useState<TrainingLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getRow('training_logs', id).then((r) => {
      if (r) {
        setExisting(r);
        setKind(r.kind);
        setPlayerId(r.player_id);
        setDate(r.date);
        setData(r.data);
        setNote(r.note ?? '');
      }
      setLoaded(true);
    });
  }, [id]);

  useEffect(() => {
    if (!playerId && access.meId && !id) setPlayerId(access.meId);
  }, [access.meId, playerId, id]);

  const teamIds = new Set(
    (members ?? []).filter((m) => m.team_id === access.teamId).map((m) => m.profile_id),
  );
  const choices = (profiles ?? []).filter(
    (p) => p.id === access.meId || (access.isStaff && (!access.teamId || teamIds.has(p.id))),
  );

  async function save() {
    setError(null);
    const clean: TrainingLogData =
      kind === 'batting'
        ? { swings: data.swings ?? 0 }
        : kind === 'bullpen'
          ? {
              pitches: Object.fromEntries(
                Object.entries(data.pitches ?? {}).filter(([, n]) => n > 0),
              ),
            }
          : { item: (data.item ?? '').trim(), value: data.value, unit: (data.unit ?? '').trim() };
    if (
      (kind === 'fitness' || kind === 'custom') &&
      (!clean.item || clean.value === undefined || Number.isNaN(clean.value))
    ) {
      setError('請填寫項目名稱與數值。');
      return;
    }
    if (kind === 'batting' && !clean.swings) {
      setError('請填寫揮棒次數。');
      return;
    }
    if (kind === 'bullpen' && !pitchTotal({ data: clean })) {
      setError('請至少記錄一球。');
      return;
    }
    await saveRow('training_logs', {
      ...(existing ?? {}),
      id: existing?.id,
      player_id: playerId,
      team_id: existing?.team_id ?? access.teamId,
      session_id: existing?.session_id ?? sessionId ?? null,
      date,
      kind,
      data: clean,
      note: note.trim() || null,
      created_by: existing?.created_by ?? null,
    });
    navigate('/training', { replace: true });
  }

  async function remove() {
    if (!existing || !confirm('確定刪除這筆紀錄？')) return;
    await deleteRow('training_logs', existing.id);
    navigate('/training', { replace: true });
  }

  if (!loaded)
    return (
      <Page title="訓練紀錄" back="/training">
        <p className="empty">載入中…</p>
      </Page>
    );

  return (
    <Page title={existing ? '編輯訓練紀錄' : '新增訓練紀錄'} back="/training">
      {!existing ? (
        <Tabs<TrainingLogKind>
          value={kind}
          onChange={setKind}
          options={(Object.keys(LOG_KIND_LABEL) as TrainingLogKind[]).map((k) => ({
            value: k,
            label: LOG_KIND_LABEL[k],
          }))}
        />
      ) : null}
      <Card>
        <div className="stack">
          <div className="grid-2">
            <Field label="球員">
              <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="日期">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          {kind === 'batting' ? (
            <Field label="揮棒次數（打擊數）">
              <Stepper
                value={data.swings ?? 0}
                step={10}
                onChange={(v) => setData({ ...data, swings: v })}
              />
            </Field>
          ) : null}

          {kind === 'bullpen' ? (
            <div className="stack">
              <div className="field-label">球種與球數（共 {pitchTotal({ data })} 球）</div>
              {PITCH_TYPES.map((p) => (
                <div
                  key={p.key}
                  className="row"
                  style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}
                >
                  <span style={{ minWidth: 64 }}>{p.label}</span>
                  <Stepper
                    value={data.pitches?.[p.key] ?? 0}
                    onChange={(v) =>
                      setData({ ...data, pitches: { ...(data.pitches ?? {}), [p.key]: v } })
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          {kind === 'fitness' || kind === 'custom' ? (
            <>
              {kind === 'fitness' ? (
                <div className="chips">
                  {FITNESS_PRESETS.map((f) => (
                    <button
                      key={f.item}
                      type="button"
                      className={`btn btn-secondary btn-sm ${data.item === f.item ? 'selected' : ''}`}
                      onClick={() => setData({ ...data, item: f.item, unit: f.unit })}
                    >
                      {f.item}
                    </button>
                  ))}
                </div>
              ) : null}
              <Field label="項目">
                <input
                  value={data.item ?? ''}
                  onChange={(e) => setData({ ...data, item: e.target.value })}
                  placeholder="例如 跳繩"
                />
              </Field>
              <div className="grid-2">
                <Field label="數值">
                  <input
                    inputMode="decimal"
                    value={data.value ?? ''}
                    onChange={(e) =>
                      setData({
                        ...data,
                        value: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="單位">
                  <input
                    value={data.unit ?? ''}
                    onChange={(e) => setData({ ...data, unit: e.target.value })}
                    placeholder="秒、公分、下…"
                  />
                </Field>
              </div>
            </>
          ) : null}

          <Field label="備註">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Button onClick={save} disabled={!playerId}>
            儲存
          </Button>
          {existing ? (
            <Button variant="danger" onClick={remove}>
              刪除
            </Button>
          ) : null}
        </div>
      </Card>
    </Page>
  );
}
