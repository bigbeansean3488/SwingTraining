import { useEffect, type ReactNode } from 'react';
import { href, useRoute, type Route } from './lib/router';
import { useOnline } from './lib/hooks';
import { ensureMe } from './lib/identity';
import { HomePage } from './features/home/HomePage';
import { AnalyzeHome } from './features/analyze/AnalyzeHome';
import { NewAnalysis } from './features/analyze/NewAnalysis';
import { ResultPage } from './features/analyze/ResultPage';
import { ShootingGuide } from './features/analyze/ShootingGuide';
import { Diagnostics } from './features/analyze/Diagnostics';
import { Badge, Empty, Page } from './ui/components';

const NAV = [
  { to: '/', icon: '⌂', label: '首頁', match: '' },
  { to: '/analyze', icon: '◎', label: '分析', match: 'analyze' },
  { to: '/training', icon: '✎', label: '訓練', match: 'training' },
  { to: '/games', icon: '⚾', label: '比賽', match: 'games' },
  { to: '/more', icon: '☰', label: '更多', match: 'more' },
];

function NotYet({ title }: { title: string }) {
  return (
    <Page title={title} back="/">
      <Empty>此功能開發中。</Empty>
    </Page>
  );
}

function analyzeRoute(route: Route): ReactNode {
  const [, sub] = route.path;
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
    case 'diagnostics':
      return <Diagnostics />;
    default:
      return <ResultPage key={sub} id={sub} />;
  }
}

function renderRoute(route: Route): ReactNode {
  switch (route.path[0]) {
    case undefined:
      return <HomePage />;
    case 'analyze':
      return analyzeRoute(route);
    case 'training':
      return <NotYet title="訓練" />;
    case 'games':
      return <NotYet title="比賽" />;
    case 'more':
      return <NotYet title="更多" />;
    default:
      return <NotYet title="找不到頁面" />;
  }
}

export function App() {
  const route = useRoute();
  const online = useOnline();
  const section = route.path[0] ?? '';
  useEffect(() => {
    ensureMe();
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
          <a key={n.to} href={href(n.to)} className={section === n.match ? 'active' : ''}>
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
