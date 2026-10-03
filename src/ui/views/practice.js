// Practice: analysis status, newest swing result (or the swings of the last
// recording), recent 5 swings.
import { esc } from '../dom.js';
import { describeSwing, CONTACT, FOCUS, focusScores } from '../../app/interpret.js';
import { CONTACT_LABELS } from '../../app/session.js';

const STAGES = [
  ['load', '影片載入'],
  ['track', 'Pose Tracking'],
  ['compute', '計算 Metrics'],
];

const RECORDING_STAGES = [
  ['load', '影片載入'],
  ['scan', '找出每一棒'],
  ['batch', '逐棒分析'],
];

const pctOf = (p) => Math.round((p || 0) * 100);
const bar = (p) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctOf(p)}"><span style="width:${pctOf(p)}%"></span></div>`;

function stageList(stages, current, detail) {
  const idx = stages.findIndex(([k]) => k === current);
  return `<ol class="stages">${stages.map(([k, label], i) => {
    const state = i < idx ? 'done' : i === idx ? 'now' : 'todo';
    const icon = state === 'done' ? '✓' : state === 'now' ? '●' : '○';
    return `<li class="${state}"><span aria-hidden="true">${icon}</span> ${label}${state === 'now' && detail ? ` ${detail}` : ''}</li>`;
  }).join('')}</ol>`;
}

/** Analysis status. st = { stage, progress, index, total, error, manual } — stages are the real pipeline steps. */
export function renderStatus(el, st) {
  if (!st || (!st.stage && !st.error)) { el.hidden = true; el.innerHTML = ''; return; }
  if (st.error) {
    el.innerHTML = `<div class="card status error" role="alert"><p class="status-title">⚠ ${esc(st.error)}</p>
      ${st.manual
    ? `<p class="muted">確認影片有拍到全身，或改為手動選擇要分析的位置。</p>
         <button type="button" class="btn btn-secondary" data-action="chooseManual">手動選擇位置</button>`
    : '<p class="muted">請再按一次「＋ 加入影片」重新選擇影片。</p>'}</div>`;
    el.hidden = false;
    return;
  }
  if (st.stage === 'choose') {
    el.innerHTML = `<div class="card status"><p class="status-title">請選擇要分析的 Swing</p>
      <p class="muted">拖動影片到這一棒「擊球」的位置，再按「分析這個位置」。</p></div>`;
    el.hidden = false;
    return;
  }
  const stop = '<button type="button" class="btn btn-secondary" data-action="stopAnalysis">停止分析</button>';
  if (st.stage === 'scan' || st.stage === 'batch') {
    const scan = st.stage === 'scan';
    const detail = scan ? `${pctOf(st.progress)}%` : `第 ${st.index + 1} / ${st.total} 棒`;
    const overall = scan ? st.progress : (st.index + (st.progress || 0)) / st.total;
    el.innerHTML = `
      <div class="card status" aria-busy="true">
        <p class="status-title">${scan ? '正在找出影片中的每一棒…' : `找到 ${st.total} 棒，正在逐棒分析…`}</p>
        ${stageList(RECORDING_STAGES, st.stage, detail)}
        ${bar(overall)}
        <p class="muted small">${scan ? '影片會從頭播放一次。' : '已分析的 Swing 會先出現在下方。'}停止後，已分析完的 Swing 會保留。</p>
        ${stop}
      </div>`;
    el.hidden = false;
    return;
  }
  el.innerHTML = `
    <div class="card status" aria-busy="true">
      <p class="status-title">正在分析這一棒…</p>
      ${stageList(STAGES, st.stage, st.stage === 'track' && st.progress !== undefined ? `${pctOf(st.progress)}%` : '')}
      ${st.stage === 'track' ? bar(st.progress) : ''}
    </div>`;
  el.hidden = false;
}

function scoreRow(s) {
  const v = s.score === null || s.score === undefined ? '—' : s.score;
  return `<li class="metric-row">
    <span class="metric-name">${esc(s.label)}</span>
    <span class="metric-score band-${s.band}">${v}</span>
    <span class="metric-text">${esc(s.text)}</span>
  </li>`;
}

function contactButtons(swing) {
  return `
    <div class="contact">
      <h3 class="q-small">這一棒擊球感覺？</h3>
      <div class="contact-btns" role="group" aria-label="Contact Quality">
        ${CONTACT_LABELS.map((l) => `<button type="button" class="contact-btn c-${l} ${swing.contact === l ? 'on' : ''}" data-action="contact" data-id="${esc(swing.id)}" data-label="${l}" aria-pressed="${swing.contact === l}">
          <span class="zh">${CONTACT[l].zh}</span><span class="en">${CONTACT[l].en}</span></button>`).join('')}
      </div>
    </div>`;
}

/**
 * Result block for one swing. Used for the newest swing on the Practice
 * screen and inside the swing detail sheet.
 */
export function resultHtml(swing, focus, previous, { showDetailButton = true, showVideoButton = false } = {}) {
  const d = describeSwing(swing, focus, previous);
  const head = `
    <div class="result-head">
      <h2>Swing #${d.number}${swing.video?.synthetic ? ' <span class="tag">synthetic</span>' : ''}</h2>
      <span class="qc qc-${d.qc.level}"><span aria-hidden="true">${d.qc.icon}</span> ${esc(d.kind === 'rejected' ? 'Tracking 不穩定' : d.qc.text)}</span>
    </div>`;
  let body = '';
  if (d.kind === 'rejected') {
    body = `
      <div class="rejected" role="alert">
        <p class="rejected-title"><span aria-hidden="true">⚠</span> ${esc(d.headline)}</p>
        <p>${esc(d.reasons[0] || '無法可靠地分析這一棒。')}</p>
        <p class="strong">${esc(d.note)}</p>
        <details class="why">
          <summary>查看原因</summary>
          <ul>${d.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          ${d.advice.length ? `<p class="muted">建議：${d.advice.map(esc).join(' ')}</p>` : ''}
        </details>
      </div>`;
  } else if (d.kind === 'baseline') {
    body = `
      <div class="baseline-note"><p class="strong">${esc(d.headline)}</p><p class="muted">${esc(d.note)}</p></div>
      ${d.qc.level === 'fair' ? `<p class="muted small">Tracking 普通：${esc(d.reasons.join('；'))}</p>` : ''}
      ${contactButtons(swing)}`;
  } else {
    const f = d.focus;
    const arrow = f.delta === null || Math.abs(f.delta) < 1 ? '' : f.delta > 0 ? '▲' : '▼';
    body = `
      <div class="focus">
        <p class="focus-kicker">今日重點</p>
        <p class="focus-label">${esc(f.label)}</p>
        <div class="focus-main">
          <span class="focus-score band-${f.band}">${f.score ?? '—'}</span>
          ${f.deltaText ? `<span class="focus-delta ${f.delta > 0 ? 'up' : f.delta < 0 ? 'down' : ''}"><span aria-hidden="true">${arrow}</span> ${esc(f.deltaText)}</span>` : ''}
        </div>
        <p class="focus-text">${esc(f.text)}</p>
      </div>
      <ul class="metrics">${d.secondary.map(scoreRow).join('')}</ul>
      ${d.qc.level === 'fair' ? `<p class="muted small">Tracking 普通：${esc(d.reasons.join('；'))}</p>` : ''}
      ${contactButtons(swing)}`;
  }
  const buttons = [
    showVideoButton ? '<button type="button" class="btn btn-secondary" data-action="toggleVideo">影片與骨架</button>' : '',
    showDetailButton ? `<button type="button" class="btn btn-secondary" data-action="openSwing" data-id="${esc(swing.id)}">這一棒詳情</button>` : '',
  ].filter(Boolean).join('');
  return `${head}${body}${buttons ? `<div class="result-actions">${buttons}</div>` : ''}`;
}

export function renderResult(el, swing, focus, previous, opts) {
  if (!swing) {
    el.innerHTML = `
      <div class="card empty">
        <p class="empty-title">準備好就開始打</p>
        <ol class="tips">
          <li>手機固定在腳架，從側面拍到<strong>全身與雙腳</strong></li>
          <li>開始錄影，連續打 N 球再停止（建議 1080p、60 FPS）</li>
          <li>按下方「＋ 加入影片」選這段影片，App 會自動找出每一棒</li>
        </ol>
        <p class="muted small">也可以一棒錄一支短片（10 秒內），會直接分析那一棒。</p>
      </div>`;
    return;
  }
  el.innerHTML = `<article class="card result" aria-live="polite">${resultHtml(swing, focus, previous, opts)}</article>`;
}

/** Recent 5 swings: focus score bars + contact labels; tap to inspect. */
export function renderRecent(el, swings, focus) {
  const last = swings.slice(-5);
  if (!last.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <section class="card recent" aria-label="最近 5 棒">
      <div class="recent-head"><h3>最近 ${last.length} 棒</h3><span class="muted">${esc(FOCUS[focus].label)}</span></div>
      <div class="recent-row">
        ${last.map((s) => {
    const score = s.valid ? focusScores(s)[focus] : null;
    const label = !s.valid ? '✗' : score === null ? 'B' : score;
    const h = score === null ? 8 : Math.max(8, score);
    const aria = `Swing ${s.number}，${!s.valid ? 'Tracking 不穩定' : score === null ? 'Baseline' : `${score} 分`}，${s.contact ? CONTACT[s.contact].zh : '未標記'}`;
    return `<button type="button" class="recent-col" data-action="openSwing" data-id="${esc(s.id)}" aria-label="${esc(aria)}">
            <span class="recent-score ${!s.valid ? 'bad' : ''}">${label}</span>
            <span class="recent-bar"><span class="${!s.valid ? 'bad' : score === null ? 'base' : `band-${score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low'}`}" style="height:${h}%"></span></span>
            <span class="recent-num">#${s.number}</span>
            <span class="recent-contact">${s.contact ? CONTACT[s.contact].zh : '—'}</span>
          </button>`;
  }).join('')}
      </div>
      <p class="muted small">B = Baseline　✗ = Tracking 不穩定（不列入 Baseline）</p>
    </section>`;
}

function contactMini(swing) {
  return `<div class="contact-btns mini" role="group" aria-label="Swing #${swing.number} Contact Quality">
    ${CONTACT_LABELS.map((l) => `<button type="button" class="contact-btn c-${l} ${swing.contact === l ? 'on' : ''}" data-action="contact" data-id="${esc(swing.id)}" data-label="${l}" aria-pressed="${swing.contact === l}"><span class="zh">${CONTACT[l].zh}</span></button>`).join('')}
  </div>`;
}

/**
 * Swings found in one long recording: one row each, with replay and a
 * one-tap Contact Quality label (easier to judge while watching the clip).
 */
export function renderBatch(el, batch, swings, focus, { playable = {} } = {}) {
  const rows = batch.ids.map((id) => swings.find((s) => s.id === id)).filter(Boolean);
  const bad = rows.filter((s) => !s.valid).length;
  const summary = [
    `找到 ${batch.found} 棒`,
    batch.stopped ? `已分析 ${rows.length} 棒（已停止）` : '',
    bad ? `${bad} 棒 Tracking 不穩定（不列入 Baseline）` : '',
  ].filter(Boolean).join('，');
  el.innerHTML = `
    <section class="card batch" aria-live="polite">
      <div class="result-head"><h2>這段影片</h2><span class="muted">${esc(FOCUS[focus].label)}</span></div>
      <p>${esc(summary)}。</p>
      <p class="muted small">按 ▶ 回看那一棒，順便標記擊球感覺。如果有不是揮棒的片段（空揮、走動），點進去刪除。</p>
      <ol class="batch-list">
        ${rows.map((s) => {
    const score = s.valid ? focusScores(s)[focus] : null;
    const label = !s.valid ? '<span class="qc qc-poor"><span aria-hidden="true">⚠</span> 不穩定</span>' : score === null ? '<span class="tag">Baseline</span>' : `<span class="batch-score band-${score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low'}">${score}</span>`;
    return `<li class="batch-row">
            <div class="batch-top">
              ${playable[s.id] ? `<button type="button" class="btn btn-secondary btn-icon" data-action="playSegment" data-id="${esc(s.id)}" aria-label="回看 Swing #${s.number}">▶</button>` : ''}
              <button type="button" class="batch-open" data-action="openSwing" data-id="${esc(s.id)}">Swing #${s.number}</button>
              ${label}
            </div>
            ${contactMini(s)}
          </li>`;
  }).join('')}
      </ol>
      <div class="result-actions"><button type="button" class="btn btn-secondary" data-action="closeBatch">完成</button></div>
    </section>`;
}
