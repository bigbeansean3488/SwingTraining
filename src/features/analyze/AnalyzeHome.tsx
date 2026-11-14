import { useRows } from '../../lib/hooks';
import { Badge, Card, Empty, LinkButton, ListLink, Page } from '../../ui/components';
import { KIND_LABEL } from './metricInfo';

export function AnalyzeHome() {
  const analyses = useRows('motion_analyses');
  const profiles = useRows('profiles');
  const name = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? '—';
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
                title={`${KIND_LABEL[a.kind]}・${name(a.player_id)}`}
                subtitle={`${new Date(a.recorded_at).toLocaleString('zh-TW')}・${a.fps.toFixed(0)} fps`}
                right={
                  a.quality.ok ? <Badge kind="ok">完成</Badge> : <Badge kind="error">需重拍</Badge>
                }
              />
            ))}
          </div>
        )}
      </Card>
      <LinkButton to="/analyze/diagnostics" variant="ghost">
        診斷與效能（技術資訊）
      </LinkButton>
    </Page>
  );
}
