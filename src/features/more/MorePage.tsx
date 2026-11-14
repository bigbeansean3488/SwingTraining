import { useSession } from '../../lib/auth';
import { useOutboxCount } from '../../lib/hooks';
import { useMe } from '../../lib/identity';
import { useCurrentTeam } from '../../lib/team';
import { Badge, ListLink, Page } from '../../ui/components';
import { useSyncStatus, syncLabel } from './syncStatus';

export function MorePage() {
  const session = useSession();
  const me = useMe();
  const team = useCurrentTeam();
  const pending = useOutboxCount();
  const sync = useSyncStatus();
  return (
    <Page title="更多">
      <div className="list">
        <ListLink
          to="/more/account"
          title="帳號與同步"
          subtitle={
            session
              ? `${session.user.email ?? ''}・${syncLabel(sync.state)}`
              : '本機模式（資料只在這支手機）'
          }
          right={pending ? <Badge kind="warn">{pending} 筆待同步</Badge> : undefined}
        />
        <ListLink to="/more/team" title="球隊" subtitle={team ? team.name : '建立或加入球隊'} />
        <ListLink to="/more/calendar" title="行事曆與出席" subtitle="訓練、比賽與出席回覆" />
        <ListLink to="/more/players" title="球員" subtitle="名單、個人檔案與趨勢" />
        {me ? (
          <ListLink to={`/more/players/${me.id}`} title="我的檔案" subtitle={me.display_name} />
        ) : null}
        <ListLink to="/more/reports" title="報表" subtitle="訓練與比賽時間軸、全隊總覽、匯出 CSV" />
        <ListLink to="/more/settings" title="設定與儲存空間" subtitle="連線設定、用量、清除資料" />
      </div>
    </Page>
  );
}
