import { Card, Page } from '../../ui/components';
import { href } from '../../lib/router';

const TILES = [
  { to: '/analyze', icon: '◎', title: '動作分析', desc: '手機影片骨架追蹤', ready: false },
  { to: '/training', icon: '✎', title: '訓練紀錄', desc: '打擊、牛棚、體能', ready: false },
  { to: '/games', icon: '⚾', title: '比賽記錄', desc: '逐打席或逐球', ready: false },
  { to: '/more/team', icon: '☷', title: '球隊', desc: '名單、行事曆、出席', ready: false },
  { to: '/more/players', icon: '☺', title: '球員', desc: '個人檔案與趨勢', ready: false },
  { to: '/more/reports', icon: '▤', title: '報表', desc: '訓練與比賽對照', ready: false },
];

export function HomePage() {
  return (
    <Page title="球隊訓練">
      <Card>
        <p style={{ margin: 0 }}>
          整合球隊管理、訓練紀錄、手機影片動作分析與比賽記錄，把訓練成果和比賽成果放在同一條時間軸上對照。
        </p>
      </Card>
      <div className="tiles">
        {TILES.map((t) => (
          <a key={t.to} className="tile" href={href(t.to)} aria-disabled={!t.ready}>
            <span className="tile-icon" aria-hidden>
              {t.icon}
            </span>
            <span>
              <strong>{t.title}</strong>
              <br />
              <span className="muted small">{t.ready ? t.desc : '開發中'}</span>
            </span>
          </a>
        ))}
      </div>
      <p className="muted small center">
        版本 {__APP_VERSION__}・建置於 {new Date(__BUILD_TIME__).toLocaleString('zh-TW')}
      </p>
    </Page>
  );
}
