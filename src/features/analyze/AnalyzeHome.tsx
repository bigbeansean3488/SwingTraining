import { analysisTimes, formatDateTime } from '../../lib/analysisTime';
import type { MotionAnalysis } from '../../lib/types';
import { SOLO } from '../../lib/edition';
import { useRows } from '../../lib/hooks';
import { Badge, Card, Empty, LinkButton, ListLink, Page } from '../../ui/components';
import { KIND_LABEL } from './metricInfo';

export function AnalyzeHome() {
  const analyses = useRows('motion_analyses');
  const profiles = useRows('profiles');
  const name = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? '—';
  // The stand-alone app normally has one person; show names once there are more.
  const showName = !SOLO || (profiles?.length ?? 0) > 1;
  const sorted = [...(analyses ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <Page title="動作分析">
      <div className="grid-2">
        <LinkButton to="/analyze/new?kind=batting">＋ 打擊分析</LinkButton>
        <LinkButton to="/analyze/new?kind=pitching">＋ 投球分析</LinkButton>
      </div>
      <div className="grid-2">
        <LinkButton to="/analyze/guide" variant="secondary">
          拍攝引導
        </LinkButton>
        <LinkButton to="/analyze/compare" variant="secondary">
          並排比較
        </LinkButton>
      </div>
      {SOLO ? null : (
        <>
          <LinkButton to="/analyze/references" variant="secondary">
            標竿動作（模仿目標）
          </LinkButton>
          <LinkButton to="/analyze/metrics" variant="secondary">
            指標說明（每個數字代表什麼）
          </LinkButton>
        </>
      )}
      <Card title="分析紀錄">
        {analyses === null ? (
          <Empty>載入中…</Empty>
        ) : sorted.length === 0 ? (
          <Empty>還沒有分析紀錄。先看「拍攝引導」，再新增一次分析。</Empty>
        ) : (
          <div className="list">
            {sorted.map((a) => (
              <ListLink
                key={a.id}
                to={`/analyze/${a.id}`}
                title={`${a.marked_good ? '★ ' : ''}${KIND_LABEL[a.kind]}${showName ? `・${name(a.player_id)}` : ''}`}
                subtitle={listTimes(a)}
                right={
                  a.quality.ok ? <Badge kind="ok">完成</Badge> : <Badge kind="error">需重拍</Badge>
                }
              />
            ))}
          </div>
        )}
      </Card>
      {SOLO ? null : (
        <LinkButton to="/analyze/diagnostics" variant="ghost">
          診斷與效能（技術資訊）
        </LinkButton>
      )}
    </Page>
  );
}

function listTimes(a: MotionAnalysis): string {
  const t = analysisTimes(a);
  const filmed = t.filmedSource === 'video' && t.filmed ? `拍攝 ${formatDateTime(t.filmed)}・` : '';
  return `${filmed}分析 ${formatDateTime(t.analyzed)}・${a.fps.toFixed(0)} fps`;
}
