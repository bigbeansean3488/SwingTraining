// Swing detail sheet: result, skeleton replay, raw numbers, baseline/delete actions.
import { esc } from '../dom.js';
import { resultHtml } from './practice.js';
import { drawReplay } from '../replay.js';

const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : Number(v).toFixed(d));

export function renderDetail(el, swing, { focus, previous, allSwings, debug }) {
  const a = swing.analysis;
  const m = a.metrics;
  const rows = m ? [
    ['Head movement（相對骨盆，最大值）', `${fmt(m.headStability.value)} T`],
    ['Stride 長度', `${fmt(m.stride.value)} T`],
    ['啟動 → 手速最快', `${fmt(m.timing.value.startToPeak, 3)} 秒`],
    ['踏腳 → 手速最快', `${fmt(m.timing.value.plantToPeak, 3)} 秒`],
    ['Hand Path 長度', `${fmt(m.wristPath.diagnostics?.pathLength)} T`],
  ] : [];
  const ev = a.events || {};
  el.innerHTML = `
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Swing #${swing.number} 詳情">
      <div class="sheet-bar"><button type="button" class="btn btn-secondary" data-action="closeSheet">‹ 返回</button></div>
      <article class="card result">${resultHtml(swing, focus, previous, { showDetailButton: false })}</article>
      ${swing.landmarks ? `<div class="card replay-card"><canvas id="replay" class="replay" aria-label="骨架回放"></canvas>
        <p class="muted small">擊球附近的骨架　<span class="key cur">■ 這一棒 Hand Path</span>　<span class="key prev">■ 最近有效 Swing</span></p></div>` : ''}
      ${m ? `<details class="card"><summary>詳細數據</summary>
        <table class="tbl"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">T = 球員軀幹長度（肩膀到髖部），不是公分。手速最快的時間點是動作參考點，不等於擊球瞬間。</p>
      </details>` : ''}
      ${debug ? `<details class="card debug"><summary>Debug：事件與偏差</summary>
        <p class="small">Events (s)：start ${fmt(ev.motionStart)} · plant ${fmt(ev.footPlant)} · peak ${fmt(ev.peakHandSpeed)} · end ${fmt(ev.swingEnd)}</p>
        <p class="small">Deviation：${Object.entries(swing.deviations || {}).map(([k, v]) => `${esc(k)} ${fmt(v, 1)}`).join(' · ') || '—'}</p>
        <p class="small">Components：${(swing.consistency?.components || []).filter((c) => c.used).map((c) => `${esc(c.name)} ${Math.round(c.score)}`).join(' · ') || '—'}</p>
        <p class="small">QC：${esc(a.qc?.level ?? '—')} ${esc((a.qc?.reasons || []).join('; '))}</p>
        <p class="small">Source：${esc(swing.video?.synthetic ? `synthetic (${swing.video.label})` : `${swing.video?.name ?? '—'} · ${swing.video?.model ?? ''} · ${swing.video?.delegate ?? ''}`)}</p>
        <p class="small">Validation：UNIT_VALIDATED · FIELD_VALIDATED: PENDING</p>
      </details>` : ''}
      <div class="card actions-card">
        <label class="switch-row">
          <input type="checkbox" data-action="exclude" data-id="${esc(swing.id)}" ${swing.excludeFromBaseline ? 'checked' : ''} ${swing.valid ? '' : 'disabled'} />
          <span>不要把這一棒列入 Baseline</span>
        </label>
        <button type="button" class="btn btn-danger" data-action="deleteSwing" data-id="${esc(swing.id)}">刪除這一棒</button>
      </div>
    </div>`;
  const canvas = el.querySelector('#replay');
  if (canvas) drawReplay(canvas, swing, allSwings, Math.max(240, Math.min(420, (el.querySelector('.replay-card')?.clientWidth || 340) - 32)));
}
