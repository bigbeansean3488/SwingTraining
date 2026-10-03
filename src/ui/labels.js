// "Motion metrics vs contact label" view. Descriptive only — no prediction.
import { labelSummary, swingRow } from '../app/session.js';

const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderLabelView(el, swings) {
  const sum = labelSummary(swings);
  const groups = ['good', 'medium', 'poor', 'unlabeled'];
  const rows = swings.map(swingRow);
  el.innerHTML = `
    <p class="muted small">Averages of valid swings by your contact label. Descriptive only — with few swings these numbers are noisy and say nothing about cause.</p>
    <table class="tbl">
      <thead><tr><th>Contact</th><th>n</th><th>Consistency</th><th>Head (T)</th><th>Stride (T)</th><th>Start→peak (s)</th></tr></thead>
      <tbody>${groups.map((g) => `<tr><td>${g}</td><td>${sum[g].count}</td><td>${fmt(sum[g].consistency, 0)}</td><td>${fmt(sum[g].head)}</td><td>${fmt(sum[g].stride)}</td><td>${fmt(sum[g].startToPeak, 3)}</td></tr>`).join('')}</tbody>
    </table>
    <details><summary class="small">All swings</summary>
    <table class="tbl">
      <thead><tr><th>#</th><th>QC</th><th>Contact</th><th>Cons.</th><th>Head</th><th>Stride</th><th>Start→peak</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.valid ? '' : 'invalid'}"><td>${r.number}</td><td>${esc(r.qc ?? '—')}</td><td>${esc(r.contact ?? '—')}</td><td>${fmt(r.consistency, 0)}</td><td>${fmt(r.head)}</td><td>${fmt(r.stride)}</td><td>${fmt(r.startToPeak, 3)}</td></tr>`).join('')}</tbody>
    </table></details>`;
}
