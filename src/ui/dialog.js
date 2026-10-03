// Minimal accessible modal dialog (confirmations, menus, rename).
import { esc } from './dom.js';

/**
 * openDialog({ title, body?, input?: { value, placeholder, label }, actions: [{ label, kind?: 'primary'|'danger'|'plain', value }] })
 * Resolves with the chosen action's value (and input text), or null when dismissed.
 */
export function openDialog({ title, body = '', input = null, actions }) {
  const host = document.getElementById('dialog');
  host.innerHTML = `
    <div class="dialog-backdrop" data-dismiss></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 id="dialog-title">${esc(title)}</h2>
      ${body ? `<p class="dialog-body">${body}</p>` : ''}
      ${input ? `<label class="field"><span>${esc(input.label || '')}</span><input id="dialog-input" type="text" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off" /></label>` : ''}
      <div class="dialog-actions">
        ${actions.map((a, i) => `<button type="button" class="btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-secondary'}" data-i="${i}">${esc(a.label)}</button>`).join('')}
      </div>
    </div>`;
  host.hidden = false;
  const prevFocus = document.activeElement;
  const first = host.querySelector('#dialog-input') || host.querySelector('.dialog-actions .btn');
  first?.focus();
  return new Promise((resolve) => {
    const close = (v) => {
      host.hidden = true;
      host.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      host.removeEventListener('click', onClick);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    // One listener per dialog, removed on close (a stale listener would act
    // on the previous dialog's actions).
    function onClick(e) {
      if (e.target.hasAttribute('data-dismiss')) return close(null);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const a = actions[Number(b.dataset.i)];
      close(a.value === null ? null : { value: a.value, text: host.querySelector('#dialog-input')?.value ?? null });
    }
    document.addEventListener('keydown', onKey);
    host.addEventListener('click', onClick);
  });
}
