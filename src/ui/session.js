// Session bar + recent swings list.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function sessionTitle(session) {
  const d = new Date(session.createdAt);
  const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const side = session.battingSide ? ` · ${session.battingSide === 'R' ? 'right' : 'left'}-handed` : '';
  return `${session.playerName || 'Player'} · ${when}${side}`;
}

export function renderSessionList(el, sessions, onResume) {
  if (!sessions.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<p class="small muted">Previous sessions</p>${sessions.slice(0, 5).map((s) => `<button class="btn list-btn" data-id="${esc(s.id)}">${esc(sessionTitle(s))}</button>`).join('')}`;
  el.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => onResume(b.dataset.id)));
}

export function renderHistory(el, swings, currentId, onSelect) {
  if (!swings.length) { el.innerHTML = '<p class="small muted">No swings yet.</p>'; return; }
  const items = [...swings].reverse().map((s) => {
    const score = s.valid ? (s.consistency?.score ?? 'base') : '✗';
    const cls = !s.valid ? 'bad' : s.consistency?.score === null || s.consistency?.score === undefined ? '' : s.consistency.score >= 80 ? 'high' : s.consistency.score >= 60 ? 'mid' : 'low';
    const flags = [s.excludeFromBaseline ? 'excluded' : '', s.video?.synthetic ? 'synthetic' : ''].filter(Boolean).join(', ');
    return `<li><button class="hist ${s.id === currentId ? 'current' : ''}" data-id="${esc(s.id)}">
      <span class="hist-num">#${s.number}</span>
      <span class="hist-score ${cls}">${esc(score)}</span>
      <span class="hist-contact">${esc(s.contact ?? '—')}</span>
      <span class="hist-flags small muted">${esc(flags)}</span>
    </button></li>`;
  }).join('');
  el.innerHTML = `<ul class="hist-list">${items}</ul>`;
  el.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => onSelect(b.dataset.id)));
}
