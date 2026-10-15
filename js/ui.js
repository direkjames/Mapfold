// Mapfold — dialogs, toasts and small DOM helpers. Author: direk james
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, kind = 'info', ms = 2800) {
  const t = document.createElement('div');
  t.className = 'toast toast-' + kind;
  t.textContent = msg;
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

let openDialog = null;

/**
 * Generic dialog. body: HTML string. buttons: [{label, value, kind, primary}]
 * Returns a promise resolving with {value, form} where form is the dialog element.
 */
export function dialog({ title, body = '', buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
  const wideClass = wide === 'xl' ? ' dialog-wide dialog-xl' : wide ? ' dialog-wide' : '';
  closeDialog();
  return new Promise(resolve => {
    const scrim = $('#scrim');
    const d = document.createElement('form');
    d.className = 'dialog' + wideClass;
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.innerHTML = `
      ${$('#tpl-corners').innerHTML}
      <button type="button" class="dlg-x" aria-label="Close">${icon('close')}</button>
      <h2 class="dlg-title">${esc(title)}</h2>
      <div class="dlg-body">${body}</div>
      <div class="dlg-actions">${buttons.map((b, i) =>
        `<button type="${b.primary ? 'submit' : 'button'}" class="btn ${b.primary ? 'btn-gilt' : ''} ${b.kind === 'danger' ? 'btn-danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    document.body.append(d);
    scrim.hidden = false;
    requestAnimationFrame(() => { scrim.classList.add('show'); d.classList.add('show'); });

    const finish = value => {
      document.removeEventListener('keydown', onKey, true);
      scrim.classList.remove('show');
      d.classList.remove('show');
      setTimeout(() => { d.remove(); if (!document.querySelector('.dialog')) scrim.hidden = true; }, 180);
      openDialog = null;
      resolve({ value, form: d });
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    openDialog = () => finish(null);

    d.addEventListener('submit', e => {
      e.preventDefault();
      const b = buttons.find(b => b.primary);
      if (b && b.validate && !b.validate(d)) return;
      finish(b ? b.value : true);
    });
    d.querySelector('.dlg-x').onclick = () => finish(null);
    d.querySelectorAll('.dlg-actions button[type=button]').forEach(btn => {
      btn.onclick = () => finish(buttons[+btn.dataset.i].value);
    });
    scrim.onclick = () => finish(null);
    onOpen?.(d);
    const first = d.querySelector('input:not([type=hidden]):not([type=radio]):not([type=file]),textarea,select');
    d.tabIndex = -1;
    setTimeout(() => (first || d).focus({ preventScroll: true }), 30);
  });
}

export function closeDialog() { if (openDialog) openDialog(); }

export async function confirmBox(title, message, { okLabel = 'Delete', danger = true } = {}) {
  const { value } = await dialog({
    title,
    body: `<p class="dlg-text">${message}</p>`,
    buttons: [
      { label: 'Cancel', value: false },
      { label: okLabel, value: true, primary: true, kind: danger ? 'danger' : '' },
    ],
  });
  return value === true;
}

export async function promptBox(title, label, initial = '', okLabel = 'Save') {
  const { value, form } = await dialog({
    title,
    body: `<label class="field"><span>${esc(label)}</span><input name="v" value="${esc(initial)}" maxlength="80" required></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: okLabel, value: 'ok', primary: true }],
  });
  if (value !== 'ok') return null;
  const v = form.querySelector('[name=v]').value.trim();
  return v || null;
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function safeName(s) {
  return (s || 'untitled').replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'untitled';
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(t).toLocaleDateString();
}
