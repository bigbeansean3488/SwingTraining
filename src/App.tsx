import { useEffect, type ReactNode } from 'react';
import { href, useRoute, type Route } from './lib/router';
import { useOnline } from './lib/hooks';
import { ensureMe } from './lib/identity';
import { initAuth } from './lib/auth';
import { MorePage } from './features/more/MorePage';
import { AccountPage } from './features/more/AccountPage';
import { SettingsPage } from './features/more/SettingsPage';
import { PlayersPage } from './features/players/PlayersPage';
import { PlayerPage } from './features/players/PlayerPage';
import { ComparePage } from './features/analyze/ComparePage';
import { TrainingHome } from './features/training/TrainingHome';
import { LogForm } from './features/training/LogForm';
import { SessionPage } from './features/training/SessionPage';
import type { TrainingLogKind } from './lib/types';
import { TeamPage } from './features/team/TeamPage';
import { JoinPage } from './features/team/JoinPage';
import { CalendarPage } from './features/team/CalendarPage';
import { EventForm, EventPage } from './features/team/EventPage';
import { GamesHome } from './features/games/GamesHome';
import { GameSetupPage } from './features/games/GameSetupPage';
import { GameScorePage } from './features/games/GameScorePage';
import { GameStatsPage, SeasonStatsPage } from './features/games/StatsPages';
import { CoachOverview, ReportsHome } from './features/reports/ReportsPages';
import { PlayerTimeline } from './features/reports/PlayerTimeline';
import { HomePage } from './features/home/HomePage';
import { AnalyzeHome } from './features/analyze/AnalyzeHome';
import { NewAnalysis } from './features/analyze/NewAnalysis';
import { ResultPage } from './features/analyze/ResultPage';
import { ReferenceComparePage } from './features/analyze/ReferenceComparePage';
import { ReferenceForm, ReferenceList } from './features/analyze/ReferencePages';
import { MetricsGuide } from './features/analyze/MetricsGuide';
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
    case 'metrics':
      return <MetricsGuide />;
    case 'diagnostics':
      return <Diagnostics />;
    case 'compare':
      return <ComparePage a={route.query.get('a')} b={route.query.get('b')} />;
    case 'references': {
      const id = route.path[2];
      if (!id) return <ReferenceList />;
      if (id === 'new')
        return (
          <ReferenceForm key={`new-${route.query.get('from')}`} from={route.query.get('from')} />
        );
      return <ReferenceForm key={id} id={id} />;
    }
    case 'reference-compare':
      return <ReferenceComparePage a={route.query.get('a')} r={route.query.get('r')} />;
    default:
      return <ResultPage key={sub} id={sub} />;
  }
}

function trainingRoute(route: Route): ReactNode {
  const [, sub, id] = route.path;
  if (sub === 'log') {
    if (id && id !== 'new') return <LogForm key={id} id={id} />;
    const kind = (route.query.get('kind') ?? 'batting') as TrainingLogKind;
    return <LogForm key={kind} initialKind={kind} sessionId={route.query.get('session')} />;
  }
  if (sub === 'session')
    return id && id !== 'new' ? <SessionPage key={id} id={id} /> : <SessionPage key="new" />;
  return <TrainingHome />;
}

function gamesRoute(route: Route): ReactNode {
  const [, id, sub] = route.path;
  if (!id) return <GamesHome />;
  if (id === 'new') return <GameSetupPage key="new" eventId={route.query.get('event')} />;
  if (id === 'stats') return <SeasonStatsPage />;
  if (sub === 'stats') return <GameStatsPage key={id} id={id} />;
  if (sub === 'setup') return <GameSetupPage key={id} id={id} />;
  return <GameScorePage key={id} id={id} />;
}

function moreRoute(route: Route): ReactNode {
  const [, sub, id] = route.path;
  switch (sub) {
    case undefined:
      return <MorePage />;
    case 'account':
      return <AccountPage />;
    case 'settings':
      return <SettingsPage />;
    case 'players':
      return id ? <PlayerPage key={id} id={id} /> : <PlayersPage />;
    case 'team':
      return <TeamPage />;
    case 'reports':
      if (id === 'team') return <CoachOverview />;
      if (id === 'player' && route.path[3])
        return <PlayerTimeline key={route.path[3]} id={route.path[3]} />;
      return <ReportsHome />;
    case 'calendar':
      if (id === 'new') return <EventForm />;
      return id ? <EventPage key={id} id={id} /> : <CalendarPage />;
    default:
      return <NotYet title="更多" />;
  }
}

function renderRoute(route: Route): ReactNode {
  switch (route.path[0]) {
    case undefined:
      return <HomePage />;
    case 'analyze':
      return analyzeRoute(route);
    case 'training':
      return trainingRoute(route);
    case 'games':
      return gamesRoute(route);
    case 'more':
      return moreRoute(route);
    case 'join':
      return <JoinPage token={route.path[1] ?? ''} />;
    default:
      return <NotYet title="找不到頁面" />;
  }
}

export function App() {
  const route = useRoute();
  const online = useOnline();
  const section = route.path[0] ?? '';
  useEffect(() => {
    ensureMe().then(() => initAuth());
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
