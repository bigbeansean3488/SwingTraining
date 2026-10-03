// Result card for one swing (practice view: few numbers, plain language).
import { describeSwing } from '../app/interpret.js';
import { CONTACT_LABELS } from '../app/session.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 3) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const QUALITY = { good: 'Good', fair: 'Fair', poor: 'Low' };

function detailsHtml(swing) {
  const a = swing.analysis;
  const m = a.metrics;
  const ev = a.events || {};
  const devs = swing.deviations || {};
  const comps = swing.consistency?.components || [];
  const rows = [];
  if (m) {
    rows.push(['Head movement (max, vs pelvis)', `${fmt(m.headStability.value)} T`, m.headStability.confidence]);
    rows.push(['Stride length', `${fmt(m.stride.value)} T`, m.stride.confidence]);
    rows.push(['Start → peak hand speed', `${fmt(m.timing.value.startToPeak)} s`, m.timing.confidence]);
    rows.push(['Plant → peak hand speed', `${fmt(m.timing.value.plantToPeak)} s`, m.timing.confidence]);
    rows.push(['Hand path length', `${fmt(m.wristPath.diagnostics?.pathLength)} T`, m.wristPath.confidence]);
  }
  return `
    <details class="details">
      <summary class="small">Details</summary>
      ${m ? `<table class="tbl"><thead><tr><th>Measurement</th><th>Value</th><th>Conf.</th></tr></thead><tbody>
        ${rows.map(([k, v, c]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td><td>${fmt(c, 2)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${Object.keys(devs).length ? `<p class="small muted">Deviation from your baseline (1 ≈ your usual swing-to-swing difference): ${Object.entries(devs).map(([k, v]) => `${esc(k)} ${fmt(v, 1)}`).join(' · ')}</p>` : ''}
      ${comps.length ? `<p class="small muted">Consistency components (0–100): ${comps.filter((c) => c.used).map((c) => `${esc(c.name)} ${Math.round(c.score)}`).join(' · ')}</p>` : ''}
      ${ev.motionStart !== undefined ? `<p class="small muted">Events (s): start ${fmt(ev.motionStart, 2)} · plant ${fmt(ev.footPlant, 2)} · peak hand speed ${fmt(ev.peakHandSpeed, 2)} · end ${fmt(ev.swingEnd, 2)}. Peak hand speed is a motion landmark, not bat–ball contact.</p>` : ''}
      <p class="small muted">Validation: unit-tested on synthetic data · field validation pending. Units are torso lengths (T), not cm.</p>
      <label class="small"><input type="checkbox" data-action="exclude" ${swing.excludeFromBaseline ? 'checked' : ''} ${swing.valid ? '' : 'disabled'} /> Exclude this swing from the baseline</label>
      <button class="btn small-btn danger" data-action="delete">Delete swing</button>
    </details>`;
}

export function renderResult(el, swing, { onLabel, onExclude, onDelete } = {}) {
  if (!swing) { el.hidden = true; return; }
  const d = describeSwing(swing);
  const source = swing.video?.synthetic ? `<span class="tag">synthetic: ${esc(swing.video.label)}</span>` : '';
  let body = '';
  if (d.kind === 'rejected') {
    body = `
      <p class="headline bad">${esc(d.headline)}</p>
      <p class="small">Analysis quality: <strong>${QUALITY[d.quality] ?? esc(d.quality)}</strong></p>
      <ul class="small reasons">${d.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${d.advice.length ? `<p class="small muted">Try: ${d.advice.map(esc).join(' ')}</p>` : ''}
      <p class="small muted">This swing is not used in your baseline.</p>`;
  } else {
    const scoreHtml = d.kind === 'compared'
      ? `<div class="score ${d.band}"><span class="score-num">${d.score ?? '—'}</span><span class="score-label">Motion consistency<br><span class="muted small">${esc(d.baselineNote)}</span></span></div>`
      : `<p class="headline">${esc(d.headline)}</p>`;
    body = `
      ${scoreHtml}
      ${d.lines?.length ? `<dl class="lines">${d.lines.map((l) => `<dt>${esc(l.label)}</dt><dd>${esc(l.text)}</dd>`).join('')}</dl>` : ''}
      ${d.quality === 'fair' ? `<p class="small warn">Analysis quality: Fair — ${esc(d.reasons.join('; '))}</p>` : ''}`;
  }
  el.innerHTML = `
    <div class="result-head"><h2>${esc(d.title)}</h2>${source}</div>
    ${body}
    <div class="contact">
      <span class="small muted">Contact quality</span>
      <div class="seg">${CONTACT_LABELS.map((l) => `<button class="btn seg-btn ${swing.contact === l ? 'on' : ''}" data-label="${l}" aria-pressed="${swing.contact === l}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>
    </div>
    ${detailsHtml(swing)}`;
  el.hidden = false;
  el.querySelectorAll('[data-label]').forEach((b) => b.addEventListener('click', () => {
    const l = b.dataset.label;
    onLabel?.(swing.contact === l ? null : l);
  }));
  el.querySelector('[data-action="exclude"]')?.addEventListener('change', (e) => onExclude?.(e.target.checked));
  el.querySelector('[data-action="delete"]')?.addEventListener('click', () => onDelete?.());
}
