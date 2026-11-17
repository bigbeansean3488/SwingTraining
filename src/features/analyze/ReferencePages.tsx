// Reference motions (標竿動作): create from an analysis, edit, delete, list.
import { useEffect, useState } from 'react';
import type { MotionKind } from '../../analysis/types';
import { useAccess } from '../../lib/access';
import { useSession } from '../../lib/auth';
import { deleteRow, saveRow, updateRow } from '../../lib/db';
import { useRow, useRows } from '../../lib/hooks';
import {
  ARM_ACTIONS,
  ARM_SLOTS,
  referenceFromAnalysis,
  useReferenceEntries,
} from '../../lib/references';
import { navigate } from '../../lib/router';
import { useCurrentTeam } from '../../lib/team';
import type { ArmAction, ArmSlot, ReferenceStyle } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  ListLink,
  Notice,
  Page,
  Tabs,
} from '../../ui/components';
import { KIND_LABEL } from './metricInfo';
import { ARM_ACTION_LABEL, ARM_SLOT_LABEL, canEditReference, styleLabels } from './referenceInfo';

function StyleFields({
  kind,
  style,
  onChange,
}: {
  kind: MotionKind;
  style: ReferenceStyle;
  onChange: (s: ReferenceStyle) => void;
}) {
  if (kind === 'batting')
    return (
      <Field label="風格標籤（可不填）" hint="例如「開放式站姿」「抬腿」">
        <input
          value={style.tag ?? ''}
          maxLength={30}
          onChange={(e) => onChange({ ...style, tag: e.target.value || null })}
        />
      </Field>
    );
  return (
    <>
      <div className="field">
        <span className="field-label">出手角度</span>
        <div className="chips ref-chips" role="group" aria-label="出手角度">
          {[null, ...ARM_SLOTS].map((s) => (
            <button
              key={s ?? 'none'}
              type="button"
              className={`btn btn-secondary btn-sm ${(style.arm_slot ?? null) === s ? 'selected' : ''}`}
              aria-pressed={(style.arm_slot ?? null) === s}
              onClick={() => onChange({ ...style, arm_slot: s as ArmSlot | null })}
            >
              {s ? ARM_SLOT_LABEL[s] : '不指定'}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">引臂</span>
        <div className="chips ref-chips" role="group" aria-label="引臂">
          {[null, ...ARM_ACTIONS].map((s) => (
            <button
              key={s ?? 'none'}
              type="button"
              className={`btn btn-secondary btn-sm ${(style.arm_action ?? null) === s ? 'selected' : ''}`}
              aria-pressed={(style.arm_action ?? null) === s}
              onClick={() => onChange({ ...style, arm_action: s as ArmAction | null })}
            >
              {s ? ARM_ACTION_LABEL[s] : '不指定'}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** New reference from an analysis (`from`), or edit an existing one (`id`). */
export function ReferenceForm({ id, from }: { id?: string; from?: string | null }) {
  const existing = useRow('reference_motions', id);
  const source = useRow('motion_analyses', id ? undefined : (from ?? undefined));
  const player = useRow('profiles', existing?.player_id ?? source?.player_id ?? undefined);
  const team = useCurrentTeam();
  const access = useAccess();
  const session = useSession();
  const [label, setLabel] = useState('');
  const [edited, setEdited] = useState(false);
  const [style, setStyle] = useState<ReferenceStyle>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setLabel(existing.label);
      setStyle(existing.style ?? {});
      setNote(existing.source_note ?? '');
    }
  }, [existing]);
  useEffect(() => {
    if (source && !edited)
      setLabel(`${KIND_LABEL[source.kind]}示範${player ? `・${player.display_name}` : ''}`);
  }, [source, player, edited]);

  const back = id ? '/analyze/references' : from ? `/analyze/${from}` : '/analyze';
  const loading = id ? existing === undefined : source === undefined;
  const missing = id ? existing === null : !source;
  if (loading)
    return (
      <Page title="標竿動作" back={back}>
        <Empty>載入中…</Empty>
      </Page>
    );
  if (missing)
    return (
      <Page title="標竿動作" back={back}>
        <Empty>找不到這筆資料。</Empty>
      </Page>
    );
  const kind = (existing?.kind ?? source?.kind)!;
  const editable = existing
    ? canEditReference(access, session?.user.id ?? null, { origin: 'team', ...existing })
    : true;
  if (source && !source.quality.ok)
    return (
      <Page title="設為標竿" back={back}>
        <Notice kind="warn">這次分析沒有通過品質檢查，不能設為標竿。</Notice>
      </Page>
    );

  async function save() {
    const name = label.trim();
    if (!name) {
      setError('請輸入名稱。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = { label: name.slice(0, 80), style, source_note: note.trim() || null };
      if (existing) {
        await updateRow('reference_motions', existing.id, meta);
        navigate('/analyze/references', { replace: true });
      } else if (source) {
        await saveRow(
          'reference_motions',
          referenceFromAnalysis(source, { ...meta, team_id: team?.id ?? null }),
        );
        navigate(`/analyze/${source.id}`, { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || !confirm(`確定刪除標竿「${existing.label}」？`)) return;
    await deleteRow('reference_motions', existing.id);
    navigate('/analyze/references', { replace: true });
  }

  return (
    <Page title={existing ? '編輯標竿' : '設為標竿'} back={back}>
      <Card>
        <p style={{ marginTop: 0 }}>
          {KIND_LABEL[kind]}・{player?.display_name ?? '—'}
          {existing?.recorded_at || source?.recorded_at ? (
            <span className="muted small">
              {' '}
              ・
              {new Date((existing?.recorded_at ?? source?.recorded_at)!).toLocaleDateString(
                'zh-TW',
              )}
            </span>
          ) : null}
        </p>
        {!existing ? (
          <Notice kind="info">
            {team
              ? `設為標竿後，「${team.name}」的所有成員都看得到這次動作的骨架與指標（不含影片與截圖），可以拿來跟自己的動作對照。`
              : '目前沒有加入球隊，這個標竿只有你自己看得到。'}
          </Notice>
        ) : null}
        {!editable ? <Notice kind="warn">只有建立的人與教練可以修改這個標竿。</Notice> : null}
        <div className="stack">
          <Field label="名稱" hint="例如「3/4 投法示範」「學長的打擊」">
            <input
              value={label}
              maxLength={80}
              disabled={!editable}
              onChange={(e) => {
                setEdited(true);
                setLabel(e.target.value);
              }}
            />
          </Field>
          {editable ? (
            <StyleFields kind={kind} style={style} onChange={setStyle} />
          ) : (
            <p className="small">{styleLabels(style).join('・') || '沒有風格標籤'}</p>
          )}
          <Field label="來源說明（可不填）" hint="例如「王教練示範，2026-11-17 本人同意分享」">
            <textarea
              value={note}
              maxLength={500}
              disabled={!editable}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {error ? <Notice kind="error">{error}</Notice> : null}
          {editable ? (
            <Button onClick={save} disabled={busy}>
              {existing ? '儲存' : '設為標竿'}
            </Button>
          ) : null}
          {existing && editable ? (
            <Button variant="danger" onClick={remove} disabled={busy}>
              刪除這個標竿
            </Button>
          ) : null}
        </div>
      </Card>
    </Page>
  );
}

/** All references (team and built-in), by motion type. */
export function ReferenceList() {
  const [kind, setKind] = useState<MotionKind>('pitching');
  const entries = useReferenceEntries(kind);
  const profiles = useRows('profiles');
  const access = useAccess();
  const session = useSession();
  const name = (pid: string | null) =>
    (pid && profiles?.find((p) => p.id === pid)?.display_name) || null;
  return (
    <Page title="標竿動作" back="/analyze">
      <p className="small muted" style={{ marginTop: 0 }}>
        標竿是隊上選來模仿的動作（例如教練或學長的示範）。在任一次分析的結果頁按「把這次設為標竿」即可新增；在結果頁按「與標竿對照」可以把自己的動作跟標竿對齊比較。
      </p>
      <Tabs
        value={kind}
        onChange={setKind}
        options={[
          { value: 'pitching', label: '投球' },
          { value: 'batting', label: '打擊' },
        ]}
      />
      <Card>
        {entries === null ? (
          <Empty>載入中…</Empty>
        ) : !entries.length ? (
          <Empty>還沒有{KIND_LABEL[kind]}標竿。</Empty>
        ) : (
          <div className="list">
            {entries.map((e) =>
              e.origin === 'team' ? (
                <ListLink
                  key={e.id}
                  to={`/analyze/references/${e.id}`}
                  title={e.label}
                  subtitle={[name(e.player_id), ...styleLabels(e.style)].filter(Boolean).join('・')}
                  right={
                    canEditReference(access, session?.user.id ?? null, e) ? (
                      <span className="chev">編輯 ›</span>
                    ) : (
                      <Badge>隊上</Badge>
                    )
                  }
                />
              ) : (
                <div key={e.id} className="list-item">
                  <div className="list-main">
                    <div className="list-title">{e.label}</div>
                    <div className="list-sub">
                      {[...styleLabels(e.style), `來源：${e.source?.title ?? '—'}`].join('・')}
                    </div>
                  </div>
                  <div className="list-right">
                    <Badge kind={e.demo ? 'warn' : 'muted'}>{e.demo ? '測試用' : '內建'}</Badge>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </Card>
    </Page>
  );
}
