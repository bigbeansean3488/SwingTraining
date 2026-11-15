import { useEffect, useMemo, useState } from 'react';
import type { MotionKind } from '../../analysis/types';
import { mean } from '../../analysis/signal';
import { useAccess } from '../../lib/access';
import { updateRow } from '../../lib/db';
import { useRow, useRows } from '../../lib/hooks';
import type { Handedness, Profile } from '../../lib/types';
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
import { LineChart } from '../../ui/LineChart';
import { formatMetric, KIND_LABEL, METRIC_INFO, METRIC_ORDER } from '../analyze/metricInfo';

type Tab = 'profile' | 'analyses' | 'trend';

export function PlayerPage({ id }: { id: string }) {
  const p = useRow('profiles', id);
  const access = useAccess();
  const [tab, setTab] = useState<Tab>('trend');
  if (p === undefined)
    return (
      <Page title="球員" back="/more/players">
        <Empty>載入中…</Empty>
      </Page>
    );
  if (p === null)
    return (
      <Page title="球員" back="/more/players">
        <Empty>找不到這位球員，或你沒有權限查看。</Empty>
      </Page>
    );
  return (
    <Page title={p.display_name} back="/more/players">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'trend', label: '趨勢' },
          { value: 'analyses', label: '分析紀錄' },
          { value: 'profile', label: '基本資料' },
        ]}
      />
      {tab === 'profile' ? <ProfileForm p={p} editable={access.canEditPlayer(p.id)} /> : null}
      {tab === 'analyses' ? <AnalysisList playerId={p.id} /> : null}
      {tab === 'trend' ? <Trends playerId={p.id} /> : null}
    </Page>
  );
}

function ProfileForm({ p, editable }: { p: Profile; editable: boolean }) {
  const [f, setF] = useState(p);
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(p), [p]);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: v }));
  };
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  async function save() {
    await updateRow('profiles', p.id, {
      display_name: f.display_name.trim() || p.display_name,
      height_cm: f.height_cm,
      bats: f.bats,
      throws: f.throws,
      birth_year: f.birth_year,
      notes: f.notes,
    });
    setSaved(true);
  }
  const hand = (v: Handedness | null, on: (v: Handedness | null) => void) => (
    <select
      value={v ?? ''}
      onChange={(e) => on((e.target.value || null) as Handedness | null)}
      disabled={!editable}
    >
      <option value="">—</option>
      <option value="R">右</option>
      <option value="L">左</option>
      <option value="S">左右開弓</option>
    </select>
  );
  return (
    <Card>
      <div className="stack">
        <Field label="姓名">
          <input
            value={f.display_name}
            onChange={(e) => set('display_name', e.target.value)}
            disabled={!editable}
            maxLength={80}
          />
        </Field>
        <div className="grid-2">
          <Field label="打擊">{hand(f.bats, (v) => set('bats', v))}</Field>
          <Field label="投球">{hand(f.throws, (v) => set('throws', v))}</Field>
        </div>
        <div className="grid-2">
          <Field label="身高（公分）">
            <input
              inputMode="decimal"
              value={f.height_cm ?? ''}
              onChange={(e) => set('height_cm', num(e.target.value))}
              disabled={!editable}
            />
          </Field>
          <Field label="出生年">
            <input
              inputMode="numeric"
              value={f.birth_year ?? ''}
              onChange={(e) => set('birth_year', num(e.target.value))}
              disabled={!editable}
            />
          </Field>
        </div>
        <Field label="備註">
          <textarea
            value={f.notes ?? ''}
            onChange={(e) => set('notes', e.target.value || null)}
            disabled={!editable}
          />
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          {p.user_id ? '已連結帳號。' : '尚未連結帳號：可在「球隊」產生邀請連結讓本人認領。'}
        </p>
        {editable ? (
          <Button onClick={save}>儲存</Button>
        ) : (
          <Notice>只有本人與教練可以修改。</Notice>
        )}
        {saved ? <Notice kind="ok">已儲存，會在連線時同步。</Notice> : null}
      </div>
    </Card>
  );
}

function AnalysisList({ playerId }: { playerId: string }) {
  const rows = useRows('motion_analyses', (r) => r.player_id === playerId, [playerId]);
  const sorted = [...(rows ?? [])].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  if (!sorted.length) return <Empty>還沒有分析紀錄。</Empty>;
  return (
    <div className="list">
      {sorted.map((a) => (
        <ListLink
          key={a.id}
          to={`/analyze/${a.id}`}
          title={`${KIND_LABEL[a.kind]}・${new Date(a.recorded_at).toLocaleDateString('zh-TW')}`}
          subtitle={`${a.fps.toFixed(0)} fps・引擎 v${a.engine_version}`}
          right={a.quality.ok ? <Badge kind="ok">完成</Badge> : <Badge kind="error">需重拍</Badge>}
        />
      ))}
    </div>
  );
}

function Trends({ playerId }: { playerId: string }) {
  const rows = useRows('motion_analyses', (r) => r.player_id === playerId && r.quality.ok, [
    playerId,
  ]);
  const [kind, setKind] = useState<MotionKind>('batting');
  const ofKind = useMemo(() => (rows ?? []).filter((r) => r.kind === kind), [rows, kind]);
  const keys = METRIC_ORDER[kind].filter((k) => ofKind.some((r) => r.metrics[k]));
  const [metric, setMetric] = useState<string>('');
  const key = keys.includes(metric)
    ? metric
    : (keys.find((k) => k === 'stride_length') ?? keys[0] ?? '');
  const points = ofKind
    .filter((r) => r.metrics[key])
    .map((r) => ({
      x: Date.parse(r.recorded_at),
      y: r.metrics[key]!.value,
      note: `引擎 v${r.engine_version}`,
    }));
  const unit = ofKind.find((r) => r.metrics[key])?.metrics[key]?.unit ?? '';
  const avg = mean(points.map((p) => p.y));
  return (
    <div className="stack">
      <Tabs<MotionKind>
        value={kind}
        onChange={setKind}
        options={[
          { value: 'batting', label: '打擊' },
          { value: 'pitching', label: '投球' },
        ]}
      />
      {!keys.length ? (
        <Empty>還沒有通過品質檢查的{KIND_LABEL[kind]}分析。</Empty>
      ) : (
        <Card title={METRIC_INFO[key]?.label ?? key}>
          <div className="stack">
            <select value={key} onChange={(e) => setMetric(e.target.value)} aria-label="指標">
              {keys.map((k) => (
                <option key={k} value={k}>
                  {METRIC_INFO[k]?.label ?? k}
                </option>
              ))}
            </select>
            <LineChart
              label={`${METRIC_INFO[key]?.label ?? key} 趨勢`}
              points={points}
              format={(v) => formatMetric({ value: v, unit })}
              reference={points.length >= 2 ? { y: avg, label: '平均' } : undefined}
            />
            <p className="small muted" style={{ margin: 0 }}>
              {METRIC_INFO[key]?.desc} 共 {points.length} 次。2D 估計值，只適合看自己的趨勢。
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
