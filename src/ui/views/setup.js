// Setup: who is practicing, batting side, training focus → 開始訓練.
import { esc, formatDate } from '../dom.js';
import { FOCUS, FOCUS_ORDER, SIDE_ZH } from '../../app/interpret.js';

export const GUEST = '訪客';

const FOCUS_HINT = {
  motion: '整體動作和最近幾棒有多接近',
  head: '揮棒過程頭部移動是否比平常多',
  stride: '跨步長度是否穩定',
  handPath: '手部路徑是否和最近幾棒相近',
};

/**
 * @param model { players, name, side, focus, sessions }
 */
export function renderSetup(el, model) {
  const { players, name, side, focus, sessions } = model;
  const chips = [...players.slice(0, 6).map((p) => p.name), GUEST];
  el.innerHTML = `
    <div class="setup">
      <h2 class="q">今天誰要練？</h2>
      <div class="chips" role="group" aria-label="球員">
        ${chips.map((n) => `<button type="button" class="chip ${n === name ? 'on' : ''}" data-action="pickPlayer" data-name="${esc(n)}" aria-pressed="${n === name}">${esc(n === GUEST ? 'Guest 訪客' : n)}</button>`).join('')}
      </div>
      <label class="field">
        <span>或輸入球員名稱</span>
        <input id="player-name" type="text" autocomplete="off" enterkeyhint="done" value="${esc(name === GUEST ? '' : name)}" placeholder="例如：Sean" />
      </label>

      <h2 class="q">打擊側</h2>
      <div class="toggle2" role="group" aria-label="打擊側">
        ${['R', 'L'].map((s) => `<button type="button" class="seg ${side === s ? 'on' : ''}" data-action="pickSide" data-side="${s}" aria-pressed="${side === s}">${SIDE_ZH[s]}</button>`).join('')}
      </div>

      <h2 class="q">今天想看什麼？</h2>
      <div class="focus-list" role="radiogroup" aria-label="Training Focus">
        ${FOCUS_ORDER.map((k) => `
          <button type="button" class="focus-opt ${focus === k ? 'on' : ''}" role="radio" aria-checked="${focus === k}" data-action="pickFocus" data-focus="${k}">
            <span class="radio" aria-hidden="true">${focus === k ? '●' : '○'}</span>
            <span><strong>${esc(FOCUS[k].label)}</strong><small>${esc(FOCUS_HINT[k])}</small></span>
          </button>`).join('')}
      </div>

      <button type="button" class="btn btn-primary btn-xl" id="start-session" data-action="start">開始訓練</button>

      ${sessions.length ? `
        <div class="resume">
          <h3>繼續之前的 Session</h3>
          ${sessions.slice(0, 3).map((s) => `<button type="button" class="row-btn" data-action="resume" data-id="${esc(s.id)}">
            <span>${esc(s.playerName || GUEST)} · ${s.battingSide ? SIDE_ZH[s.battingSide] : '—'}</span><span class="muted">${formatDate(s.createdAt)}</span></button>`).join('')}
        </div>` : ''}
    </div>`;
}
