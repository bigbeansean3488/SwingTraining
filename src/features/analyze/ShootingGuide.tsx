import { Card, LinkButton, Notice, Page } from '../../ui/components';

function TopView({ kind }: { kind: 'batting' | 'pitching' }) {
  // Top-down sketch. Pitcher at the top, home plate at the bottom.
  return (
    <svg
      viewBox="0 0 320 260"
      className="chart"
      role="img"
      aria-label={kind === 'batting' ? '打擊機位俯視圖' : '投球機位俯視圖'}
    >
      <rect x="0" y="0" width="320" height="260" fill="none" />
      <line
        x1="160"
        y1="30"
        x2="160"
        y2="220"
        stroke="currentColor"
        strokeDasharray="6 6"
        opacity="0.4"
      />
      <text x="168" y="24">
        投手方向
      </text>
      <circle cx="160" cy="40" r="10" fill="none" stroke="currentColor" />
      <polygon points="150,212 170,212 170,222 160,230 150,222" fill="none" stroke="currentColor" />
      <text x="176" y="230">
        本壘
      </text>
      {kind === 'batting' ? (
        <>
          <circle cx="118" cy="212" r="9" fill="#c8202e" />
          <text x="62" y="248">
            打者（右打）
          </text>
          <g transform="translate(260 212)">
            <rect x="-14" y="-10" width="28" height="20" rx="4" fill="#0b2545" />
            <circle cx="-14" cy="0" r="5" fill="#9cc3ff" />
          </g>
          <line
            x1="244"
            y1="212"
            x2="132"
            y2="212"
            stroke="#0b2545"
            strokeWidth="2"
            markerEnd="url(#arr)"
          />
          <text x="214" y="198">
            手機 4–6 m
          </text>
        </>
      ) : (
        <>
          <circle cx="160" cy="60" r="9" fill="#c8202e" />
          <text x="176" y="64">
            投手（右投）
          </text>
          <g transform="translate(50 60)">
            <rect x="-14" y="-10" width="28" height="20" rx="4" fill="#0b2545" />
            <circle cx="14" cy="0" r="5" fill="#9cc3ff" />
          </g>
          <line
            x1="66"
            y1="60"
            x2="148"
            y2="60"
            stroke="#0b2545"
            strokeWidth="2"
            markerEnd="url(#arr)"
          />
          <text x="18" y="92">
            手機 4–6 m（三壘側）
          </text>
        </>
      )}
      <defs>
        <marker
          id="arr"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#0b2545" />
        </marker>
      </defs>
    </svg>
  );
}

export function ShootingGuide() {
  return (
    <Page title="拍攝引導" back="/analyze">
      <Notice kind="warn">
        <strong>安全第一：</strong>拍打擊時請在打擊籠或防護網後方拍攝，手機不要放在擊球路徑上。
      </Notice>

      <Card title="打擊：側面機位">
        <TopView kind="batting" />
        <ul>
          <li>
            手機在打者<strong>正前方</strong>（本壘板另一側），鏡頭對著打者胸口，和投手－捕手連線
            <strong>垂直</strong>。
          </li>
          <li>左打者就站到另一側，一樣對著胸口。</li>
        </ul>
      </Card>

      <Card title="投球：側面機位">
        <TopView kind="pitching" />
        <ul>
          <li>
            手機和投球方向<strong>垂直</strong>，對著投手抬腿時的胸口。右投在三壘側、左投在一壘側。
          </li>
          <li>畫面要包含投手板到前腳著地的整段跨步。</li>
        </ul>
      </Card>

      <Card title="距離、高度、方向">
        <ul>
          <li>
            <strong>距離</strong> 4～6 公尺：全身加上跨步都在畫面內，左右各留約一個身長的空間。
          </li>
          <li>
            <strong>高度</strong> 約腰部（1 公尺），手機水平，不要仰拍或俯拍。
          </li>
          <li>
            <strong>手機打橫拍攝</strong>，跨步才有空間。
          </li>
          <li>
            用三腳架或靠在穩定的地方。<strong>不要跟拍、不要變焦</strong>。
          </li>
          <li>畫面中只有一位球員，衣服和背景顏色要有對比，避免太寬鬆的衣服。</li>
        </ul>
      </Card>

      <Card title="光線">
        <ul>
          <li>
            順光或側光，<strong>避免背光</strong>（太陽或燈在球員後面）。
          </li>
          <li>慢動作需要更多光；室內或傍晚畫面會變暗、變模糊，追蹤會變差。</li>
        </ul>
      </Card>

      <Card title="幀率設定（慢動作）">
        <ul>
          <li>
            <strong>iPhone</strong>：設定 → 相機 → 錄製慢動作 → 選 <strong>1080p 240 fps</strong>
            ；拍攝時在相機 App 選「慢動作」。
          </li>
          <li>
            <strong>Android</strong>：相機 App 的「慢動作」模式，選 120 或 240 fps（960 fps
            通常只能錄很短，不建議）。
          </li>
          <li>
            一支影片只拍<strong>一次完整動作</strong>，動作前後各留約 1 秒。
          </li>
        </ul>
      </Card>

      <Card title="取得原始高幀率檔（重要）">
        <p style={{ marginTop: 0 }}>
          從相簿選影片時，手機可能把慢動作影片「轉成一般速度」或降成 30 fps。App
          會顯示實際讀到的幀率：如果拍的是 240 fps 卻顯示 30 fps，就是被轉過了。
        </p>
        <ul>
          <li>
            <strong>iPhone</strong>：在「照片」打開影片 → 分享 → <strong>儲存到「檔案」</strong>
            ；回到本 App 選擇影片時，點「瀏覽」從「檔案」選取。
          </li>
          <li>
            <strong>Android</strong>：選擇影片時改用「檔案」或「文件」，從 DCIM/Camera 選原始檔。
          </li>
          <li>如果只能拿到被拉長的檔案，可以在分析的「進階選項」填入實際拍攝 fps。</li>
        </ul>
        <p className="small muted">以上做法需要在不同手機上實測確認，結果會記錄在專案文件中。</p>
      </Card>

      <LinkButton to="/analyze/new?kind=batting">開始打擊分析</LinkButton>
    </Page>
  );
}
