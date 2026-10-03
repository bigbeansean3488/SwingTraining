// Review: session overview, focus trend, swing list. Descriptive only.
import { esc, formatDate } from '../dom.js';
import { reviewSession } from '../../app/review.js';
import { FOCUS, CONTACT, SIDE_ZH } from '../../app/interpret.js';
import { renderLabelView } from '../labels.js';

const COMPONENT_LABEL = { head: 'Head movement', stride: 'Stride', timing: '節奏（Timing）', wristPath: 'Hand Path' };

function trendChart(series) {
  const pts = series.filter((p) => p.valid);
  if (pts.length < 2) return '';
  const W = 320; const H = 120; const pad = 16;
  const n = series.length;
  const x = (i) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - (v / 100) * (H - 2 * pad);
  let path = '';
  let pen = false;
  series.forEach((p, i) => {
    if (p.score === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`;
    pen = true;
  });
  const dots = series.map((p, i) => {
    if (!p.valid) return `<text x="${x(i)}" y="${H - 2}" class="chart-x" text-anchor="middle">✗</text>`;
    if (p.score === null) return '';
    return `<circle cx="${x(i)}" cy="${y(p.score)}" r="${p.contact === 'good' ? 5 : 3.5}" class="${p.contact === 'good' ? 'dot-good' : 'dot'}"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Training Focus 分數趨勢">
    <line x1="${pad}" x2="${W - pad}" y1="${y(80)}" y2="${y(80)}" class="grid"/><line x1="${pad}" x2="${W - pad}" y1="${y(60)}" y2="${y(60)}" class="grid"/>
    <path d="${path}" class="line"/>${dots}</svg>
    <p class="muted small">大圓點 = 扎實 Good　✗ = Tracking 不穩定</p>`;
}

/**
 * @param model { session, swings, focus, sessions }
 */
export function renderReview(el, model) {
  const { session, swings, focus, sessions } = model;
  if (!session) {
    el.innerHTML = `
      <div class="card"><h2>紀錄</h2><p class="muted">目前沒有進行中的 Session。</p>
      ${sessions.length ? sessions.slice(0, 10).map((s) => `<button type="button" class="row-btn" data-action="resume" data-id="${esc(s.id)}"><span>${esc(s.playerName || '訪客')} · ${s.battingSide ? SIDE_ZH[s.battingSide] : '—'}</span><span class="muted">${formatDate(s.createdAt)}</span></button>`).join('') : '<p class="muted">還沒有任何紀錄。</p>'}
      </div>`;
    return;
  }
  const r = reviewSession(swings, focus);
  const f = FOCUS[focus].label;
  const tile = (label, value, sub = '', action = '') => `<div class="tile" ${action}><span class="tile-label">${label}</span><span class="tile-value">${value}</span>${sub ? `<span class="tile-sub">${sub}</span>` : ''}</div>`;
  const trend = r.trend ? `${Math.round(r.trend.first)} → ${Math.round(r.trend.last)}` : '—';
  const cbf = r.contactByFocus;
  el.innerHTML = `
    <div class="card">
      <h2>今日 Session</h2>
      <p class="muted">${esc(session.playerName || '訪客')} · ${session.battingSide ? SIDE_ZH[session.battingSide] : '—'} · ${formatDate(session.createdAt)}</p>
      <div class="tiles">
        ${tile('Swings', r.total, `有效 ${r.valid}・不穩定 ${r.rejected}`)}
        ${tile(esc(f), trend, r.trend ? `前 ${r.trend.k} 棒 → 最近 ${r.trend.k} 棒平均` : '至少 4 棒有分數後顯示')}
        ${tile('Good Contact', r.labeled ? `${r.contactCounts.good} / ${r.labeled}` : '—', r.labeled ? `已標記 ${r.labeled} 棒` : '尚未標記')}
        ${r.best ? `<button type="button" class="tile tile-btn" data-action="openSwing" data-id="${esc(r.best.id)}"><span class="tile-label">Best Consistency</span><span class="tile-value">Swing #${r.best.number}</span><span class="tile-sub">Motion Consistency ${r.best.score}</span></button>` : tile('Best Consistency', '—')}
      </div>
      ${r.largestVariation ? `<p class="insight">與 Baseline 差異最常出現在 <strong>${COMPONENT_LABEL[r.largestVariation.component]}</strong></p>` : ''}
      ${cbf ? `<p class="insight">${esc(f)} 較高的 Swing 中，扎實 Good 比例 ${Math.round(cbf.high.goodRate * 100)}%（${cbf.high.n} 棒）；較低的 Swing 中為 ${Math.round(cbf.low.goodRate * 100)}%（${cbf.low.n} 棒）。<span class="muted">僅為描述，不代表因果。</span></p>` : ''}
    </div>
    <div class="card">
      <h3>${esc(f)} 趨勢</h3>
      ${trendChart(r.series) || '<p class="muted">至少 2 棒有效 Swing 後顯示。</p>'}
    </div>
    <div class="card">
      <h3>所有 Swing</h3>
      <ul class="swing-list">
        ${[...r.series].reverse().map((p) => `<li><button type="button" class="row-btn" data-action="openSwing" data-id="${esc(p.id)}">
          <span>Swing #${p.number}</span>
          <span class="${!p.valid ? 'bad' : ''}">${!p.valid ? '⚠ 不穩定' : p.score === null ? 'Baseline' : `${p.score}`}</span>
          <span class="muted">${p.contact ? CONTACT[p.contact].zh : '—'}</span></button></li>`).join('')}
      </ul>
    </div>
    <details class="card">
      <summary>Contact Quality 對照</summary>
      <div id="label-view"></div>
    </details>`;
  renderLabelView(el.querySelector('#label-view'), swings);
}
