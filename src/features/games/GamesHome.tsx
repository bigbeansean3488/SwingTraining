import { useAccess } from '../../lib/access';
import { Badge, Empty, LinkButton, ListLink, Page } from '../../ui/components';
import { useTeamReplays } from './gameData';

export function GamesHome() {
  const access = useAccess();
  const replays = useTeamReplays(access.teamId);
  const games = [...(replays ?? [])].sort((a, b) =>
    b.game.game_date.localeCompare(a.game.game_date),
  );
  if (!access.teamId) {
    return (
      <Page title="比賽">
        <Empty>請先在「更多 → 球隊」建立或加入球隊。</Empty>
      </Page>
    );
  }
  return (
    <Page title="比賽">
      <div className="grid-2">
        {access.isStaff ? <LinkButton to="/games/new">＋ 新增比賽</LinkButton> : null}
        <LinkButton to="/games/stats" variant="secondary">
          球季數據
        </LinkButton>
      </div>
      {!games.length ? (
        <Empty>還沒有比賽。</Empty>
      ) : (
        <div className="list">
          {games.map(({ game, result }) => (
            <ListLink
              key={game.id}
              to={`/games/${game.id}`}
              title={`${game.home_away === 'home' ? 'vs' : '@'} ${game.opponent}`}
              subtitle={`${game.game_date}・${game.mode === 'pitch' ? '逐球' : '簡化'}模式`}
              right={
                <span className="row" style={{ gap: 6 }}>
                  <strong className="mono">
                    {result.state.score.us}：{result.state.score.opp}
                  </strong>
                  {game.status === 'final' ? (
                    <Badge>結束</Badge>
                  ) : game.status === 'live' ? (
                    <Badge kind="warn">進行中</Badge>
                  ) : null}
                </span>
              }
            />
          ))}
        </div>
      )}
    </Page>
  );
}
