// Motion metrics vs Contact Quality label. Descriptive only — no prediction.
import { labelSummary } from '../app/session.js';
import { esc } from './dom.js';

const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const ROWS = [['good', '扎實 Good'], ['medium', '普通 Medium'], ['poor', '沒打好 Poor'], ['unlabeled', '未標記']];

export function renderLabelView(el, swings) {
  const sum = labelSummary(swings);
  el.innerHTML = `
    <p class="muted small">依你標記的 Contact Quality 分組（只計有效 Swing）的平均值。棒數少時數字變動大，也不代表因果。</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th scope="col">Contact</th><th scope="col">棒數</th><th scope="col">Motion</th><th scope="col">Head (T)</th><th scope="col">Stride (T)</th></tr></thead>
      <tbody>${ROWS.map(([g, label]) => `<tr data-group="${g}"><th scope="row">${esc(label)}</th><td>${sum[g].count}</td><td>${fmt(sum[g].consistency, 0)}</td><td>${fmt(sum[g].head)}</td><td>${fmt(sum[g].stride)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}
