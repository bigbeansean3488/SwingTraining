import { useEffect, useState, type ReactNode } from 'react';
import { href, useRoute } from './lib/router';
import { HomePage } from './features/home/HomePage';
import { Badge, Page, Empty } from './ui/components';

const NAV = [
  { to: '/', icon: '⌂', label: '首頁', match: '' },
  { to: '/analyze', icon: '◎', label: '分析', match: 'analyze' },
  { to: '/training', icon: '✎', label: '訓練', match: 'training' },
  { to: '/games', icon: '⚾', label: '比賽', match: 'games' },
  { to: '/more', icon: '☰', label: '更多', match: 'more' },
];

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function NotYet({ title }: { title: string }) {
  return (
    <Page title={title} back="/">
      <Empty>此功能開發中。</Empty>
    </Page>
  );
}

function renderRoute(path: string[]): ReactNode {
  const [section] = path;
  switch (section) {
    case undefined:
      return <HomePage />;
    case 'analyze':
      return <NotYet title="動作分析" />;
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
  return (
    <div className="app">
      {!online ? (
        <span className="status-pill">
          <Badge kind="warn">離線中</Badge>
        </span>
      ) : null}
      {renderRoute(route.path)}
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
