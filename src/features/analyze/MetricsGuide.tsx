import type { MotionKind } from '../../analysis/types';
import { Card, Page, Tabs } from '../../ui/components';
import { useState } from 'react';
import { LITERATURE_CAVEAT, REFERENCES, literatureFor } from './literature';
import { DISCLAIMER, KIND_LABEL, METRIC_GROUPS, infoFor } from './metricInfo';
import { LiteratureBlock, TorsoIllustration } from './MetricViews';

/** Every metric explained in plain words, plus the reference list. */
export function MetricsGuide() {
  const [kind, setKind] = useState<MotionKind>('batting');
  return (
    <Page title="指標說明" back="/analyze">
      <Card>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'nowrap' }}>
          <TorsoIllustration />
          <div>
            <p style={{ marginTop: 0 }}>
              <strong>軀幹長</strong>
              ：肩膀中心到骨盆中心的長度。距離都用它當單位，所以拍攝距離遠近不影響數字；也因此不能換算成公分，不同人之間也不適合直接比較。
            </p>
            <p style={{ marginBottom: 0 }}>
              <strong>角度</strong>：180° 是完全打直。都是畫面上的平面角度，手機要放在正側面。
            </p>
          </div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {DISCLAIMER}
        </p>
      </Card>

      <Tabs
        value={kind}
        onChange={(v) => setKind(v as MotionKind)}
        options={[
          { value: 'batting', label: KIND_LABEL.batting },
          { value: 'pitching', label: KIND_LABEL.pitching },
        ]}
      />

      {METRIC_GROUPS[kind].map((g) => (
        <Card key={g.id} title={g.title}>
          <p className="metric-group-about" style={{ marginTop: 0 }}>
            {g.about}
          </p>
          {[...g.primary, ...g.more].map((k) => {
            const i = infoFor(kind, k);
            if (!i) return null;
            const lit = literatureFor(kind, k);
            return (
              <div key={k} className="metric">
                <div className="metric-name">{i.label}</div>
                <dl className="explain" style={{ marginTop: 0 }}>
                  <dt>量什麼</dt>
                  <dd>{i.what}</dd>
                  <dt>為什麼要看</dt>
                  <dd>{i.why}</dd>
                  <dt>量不準的地方</dt>
                  <dd>{i.limit}</dd>
                </dl>
                {lit.length ? <LiteratureBlock notes={lit} /> : null}
              </div>
            );
          })}
        </Card>
      ))}

      <Card title="參考文獻">
        <p className="small muted" style={{ marginTop: 0 }}>
          {LITERATURE_CAVEAT}
        </p>
        <ol className="small" style={{ paddingLeft: 20, margin: 0 }}>
          {Object.values(REFERENCES).map((r) => (
            <li key={r.id} style={{ marginBottom: 8 }}>
              {r.citation}{' '}
              <a href={r.url} target="_blank" rel="noreferrer">
                連結
              </a>
            </li>
          ))}
        </ol>
      </Card>
    </Page>
  );
}
