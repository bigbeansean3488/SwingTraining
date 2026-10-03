// Small DOM helpers shared by views.
export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Route clicks on [data-action] descendants of `root` to handlers[action](dataset, element, event). */
export function delegate(root, handlers) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || !root.contains(t)) return;
    const fn = handlers[t.dataset.action];
    if (fn) fn(t.dataset, t, e);
  });
}

export function formatDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
