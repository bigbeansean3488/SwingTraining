// Stand-alone motion analysis app for people outside the team (docs/DECISIONS.md
// D27): the analysis pages only, no account, no team features, no cloud sync.
// Everything stays in this browser; backups are files the user keeps.
import { useEffect, type ReactNode } from 'react';
import { href, useRoute, type Route } from './lib/router';
import { useOnline } from './lib/hooks';
import { ensureMe } from './lib/identity';
import { AnalyzeHome } from './features/analyze/AnalyzeHome';
import { NewAnalysis } from './features/analyze/NewAnalysis';
import { ResultPage } from './features/analyze/ResultPage';
import { ComparePage } from './features/analyze/ComparePage';
import { MetricsGuide } from './features/analyze/MetricsGuide';
import { ShootingGuide } from './features/analyze/ShootingGuide';
import { Diagnostics } from './features/analyze/Diagnostics';
import { SoloMorePage } from './features/solo/SoloMorePage';
import { Badge, Empty, Page } from './ui/components';

type Section = 'analyze' | 'guide' | 'metrics' | 'more';

const NAV: { to: string; icon: string; label: string; section: Section }[] = [
  { to: '/analyze', icon: '◎', label: '分析', section: 'analyze' },
  { to: '/analyze/guide', icon: '▣', label: '拍攝', section: 'guide' },
  { to: '/analyze/metrics', icon: '?', label: '指標', section: 'metrics' },
  { to: '/more', icon: '☰', label: '更多', section: 'more' },
];

function sectionOf(route: Route): Section {
  const [top, sub] = route.path;
  if (top === 'more') return 'more';
  if (sub === 'guide') return 'guide';
  if (sub === 'metrics') return 'metrics';
  return 'analyze';
}

function renderRoute(route: Route): ReactNode {
  const [top, sub] = route.path;
  if (top === 'more') return <SoloMorePage />;
  if (top !== undefined && top !== 'analyze') return <NotFound />;
  switch (sub) {
    case undefined:
      return <AnalyzeHome />;
    case 'new': {
      const kind = route.query.get('kind') === 'pitching' ? 'pitching' : 'batting';
      return (
        <NewAnalysis
          key={kind}
          kind={kind}
          devVideo={import.meta.env.DEV ? route.query.get('devVideo') : null}
        />
      );
    }
    case 'guide':
      return <ShootingGuide />;
    case 'metrics':
      return <MetricsGuide />;
    case 'diagnostics':
      return <Diagnostics />;
    case 'compare':
      return <ComparePage a={route.query.get('a')} b={route.query.get('b')} />;
    // Reference motions (標竿) are a team feature.
    case 'references':
    case 'reference-compare':
      return <NotFound />;
    default:
      return <ResultPage key={sub} id={sub} />;
  }
}

function NotFound() {
  return (
    <Page title="找不到頁面" back="/analyze">
      <Empty>這個版本沒有這個頁面。</Empty>
    </Page>
  );
}

export function SoloApp() {
  const route = useRoute();
  const online = useOnline();
  const section = sectionOf(route);
  useEffect(() => {
    void ensureMe();
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.raw]);
  return (
    <div className="app">
      {!online ? (
        <span className="status-pill">
          <Badge kind="warn">離線中</Badge>
        </span>
      ) : null}
      {renderRoute(route)}
      <nav className="bottom-nav" aria-label="主選單">
        {NAV.map((n) => (
          <a key={n.to} href={href(n.to)} className={section === n.section ? 'active' : ''}>
            <span className="nav-icon" aria-hidden>
              {n.icon}
            </span>
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
