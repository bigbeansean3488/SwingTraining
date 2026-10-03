// Settings: session/player/data management + Developer Tools (debug mode).
import { esc, formatDate } from '../dom.js';
import { FOCUS, SIDE_ZH } from '../../app/interpret.js';

export const DEMOS = [
  ['normal', 'Normal'],
  ['longStride', 'Longer stride'],
  ['shortStride', 'Shorter stride'],
  ['head', 'More head movement'],
  ['handPath', 'Different hand path'],
  ['late', 'Later timing'],
  ['badTracking', 'Tracking failure'],
  ['recording', 'Recording ×5 swings'],
];

/**
 * @param model { session, swings, players, sessions, debug, poseModel, multiSwing, env, diag, version }
 */
export function renderSettings(el, m) {
  el.innerHTML = `
    ${m.session ? `
    <section class="card">
      <h2>目前 Session</h2>
      <p>${esc(m.session.playerName || '訪客')} · ${m.session.battingSide ? SIDE_ZH[m.session.battingSide] : '—'} · ${esc(FOCUS[m.session.focus || 'motion'].label)}</p>
      <p class="muted">${formatDate(m.session.createdAt)} 開始 · ${m.swings.length} 棒</p>
      <div class="btn-stack">
        <button type="button" class="btn btn-secondary" data-action="rename">重新命名</button>
        <button type="button" class="btn btn-secondary" data-action="changeFocus">變更 Training Focus</button>
        <button type="button" class="btn btn-secondary" data-action="export">匯出資料（JSON）</button>
        <button type="button" class="btn btn-secondary" data-action="endSession">結束 Session</button>
      </div>
    </section>` : ''}

    <section class="card">
      <h2>球員</h2>
      ${m.players.length ? `<ul class="plain-list">${m.players.map((p) => `<li class="player-row"><span>${esc(p.name)}${p.battingSide ? ` · ${SIDE_ZH[p.battingSide]}` : ''}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-action="removePlayer" data-name="${esc(p.name)}" aria-label="從捷徑移除 ${esc(p.name)}">移除</button></li>`).join('')}</ul>` : '<p class="muted">開始訓練後，球員會自動加入捷徑。</p>'}
    </section>

    <section class="card">
      <h2>資料</h2>
      <p class="muted">所有資料只存在這支手機的瀏覽器裡，影片不會被儲存。</p>
      ${m.sessions.length ? `<h3>過去的 Session</h3>${m.sessions.slice(0, 10).map((s) => `<button type="button" class="row-btn" data-action="resume" data-id="${esc(s.id)}"><span>${esc(s.playerName || '訪客')} · ${s.battingSide ? SIDE_ZH[s.battingSide] : '—'}</span><span class="muted">${formatDate(s.createdAt)}</span></button>`).join('')}` : ''}
    </section>

    <section class="card">
      <label class="switch-row">
        <input type="checkbox" id="debug-toggle" data-action="toggleDebug" ${m.debug ? 'checked' : ''} />
        <span><strong>Developer Tools</strong><br><span class="muted small">給開發與驗證用，練習時不需要開啟</span></span>
      </label>
      ${m.debug ? `
      <div class="dev" id="dev-tools">
        <h3>Synthetic Swing</h3>
        <p class="muted small">產生合成的骨架揮棒，用來測試流程，不是真實量測。${m.session ? '' : '需要先開始一個 Session。'}</p>
        <div class="demo-grid">${DEMOS.map(([k, label]) => `<button type="button" class="btn btn-secondary btn-sm" data-demo="${k}" data-action="demo" ${m.session ? '' : 'disabled'}>${label}</button>`).join('')}</div>

        <h3>Pose model</h3>
        <label class="field"><span>MediaPipe Pose Landmarker</span>
          <select id="model-variant" data-action="noop">
            ${['lite', 'full', 'heavy'].map((v) => `<option value="${v}" ${m.poseModel === v ? 'selected' : ''}>${v}${v === 'full' ? '（預設）' : v === 'lite' ? '（較快）' : '（較慢）'}</option>`).join('')}
          </select></label>

        <h3>長影片（超過 10 秒）</h3>
        <label class="switch-row">
          <input type="checkbox" id="multi-swing-toggle" data-action="toggleMultiSwing" ${m.multiSwing ? 'checked' : ''} />
          <span>自動找出每一棒</span>
        </label>
        <p class="muted small">關閉時改為手動拖到一棒再分析（「進階」可設定秒數）。</p>

        <h3>Environment</h3>
        <p class="small mono" id="env-status">${esc(m.env)}</p>

        <h3>Diagnostics</h3>
        <pre class="diag" id="diag">${esc(m.diag)}</pre>
        <p class="muted small">Validation：所有指標皆為 UNIT_VALIDATED（合成資料），FIELD_VALIDATED: PENDING。版本 ${esc(m.version)}</p>
      </div>` : ''}
    </section>`;
}
