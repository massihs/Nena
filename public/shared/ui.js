import { faDigits, num } from './fa.js';

// --- DOM helpers ------------------------------------------------------------

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// --- icons (24×24 stroke icons) ---------------------------------------------

const P = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  back: '<path d="M9 18l6-6-6-6"/>',
  forward: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M3 7a2 2 0 012-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16.5" cy="13.5" r="1.3"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 005 5L15 12l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
  chat: '<path d="M21 12a8 8 0 01-11.5 7.2L4 20.5l1.3-4.5A8 8 0 1121 12z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10.5 3 8 4s-1 4 4 4zM12 8s1.5-5 4-4 1 4-4 4z"/>',
  tag: '<path d="M3 12V4a1 1 0 011-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  history: '<path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  logout: '<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l-5-5 5-5M5 12h11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  send: '<path d="M21 3L3 10.5l7 3 3 7z"/><path d="M10 13.5L21 3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
  bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>',
  sos: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5h.01"/>',
  navigate: '<path d="M3 11l18-8-8 18-2-8z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4M12 17h.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  car: '<path d="M5 17h14M3 13l2-5.5A2 2 0 016.9 6h10.2a2 2 0 011.9 1.5L21 13v4a1 1 0 01-1 1h-1.5M3 13v4a1 1 0 001 1h1.5M3 13h18"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
  doc: '<path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4M8 9h8M8 13h5"/>',
  power: '<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1011.2 0"/>',
  fire: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-4 9-2-1-3-3-3-3s-2 3-2 6c0 4 3 7 7 7z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V4a1 1 0 00-1-1H4a1 1 0 00-1 1v11a1 1 0 001 1h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4a3.5 3.5 0 010 7M18 14.5c2.5.5 4 2.5 4 5.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="14" r=".6" fill="currentColor"/><circle cx="15" cy="14" r=".6" fill="currentColor"/>',
  hospital: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  school: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
  plane: '<path d="M10.5 13.5L3 11l1.5-1.5 8 1 4-4.5a2 2 0 013 3L15 13l1 8-1.5 1.5-2.5-7.5-3 3v3L7.5 22 6 18l-4-1.5L3.5 15h3z"/>',
  road: '<path d="M8 3L5 21M16 3l3 18M12 4v3M12 11v3M12 18v2"/>',
  tree: '<path d="M12 22v-7M12 2l6 9h-3l4 5H5l4-5H6z"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ic ${cls}`;
  span.style.display = 'inline-flex';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

// Side-view vehicle illustrations used in ride option lists.
const VEHICLES = {
  car: (c = '#111') => `<svg viewBox="0 0 64 40"><path d="M8 28c0-4 2-6 5-7l7-7c2-2 4-3 7-3h12c3 0 5 1 7 3l6 7c3 1 5 3 5 7v3H8z" fill="${c}"/><path d="M22 15l-5 6h13v-8h-5c-1 0-2 1-3 2zm11-2v8h15l-5-6c-1-1-2-2-4-2z" fill="#cfe3ff"/><circle cx="19" cy="31" r="5" fill="#222" stroke="#fff" stroke-width="2"/><circle cx="47" cy="31" r="5" fill="#222" stroke="#fff" stroke-width="2"/></svg>`,
  'car-plus': () => VEHICLES.car('#3b3b3b'),
  van: () => `<svg viewBox="0 0 64 40"><path d="M6 30V12c0-2 1-3 3-3h32c3 0 5 1 7 3l8 8c1 1 2 3 2 5v5z" fill="#1d3fa6"/><path d="M11 13h9v7h-9zm12 0h9v7h-9zm12 0h6c1 0 2 0 3 1l5 6H35z" fill="#cfe3ff"/><circle cx="17" cy="31" r="5" fill="#222" stroke="#fff" stroke-width="2"/><circle cx="47" cy="31" r="5" fill="#222" stroke="#fff" stroke-width="2"/></svg>`,
  bike: () => `<svg viewBox="0 0 64 40"><circle cx="15" cy="28" r="8" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="49" cy="28" r="8" fill="none" stroke="currentColor" stroke-width="3"/><path d="M15 28l10-12h12l6 12M30 16l-3-5h-5M40 12h6l3 16" fill="none" stroke="#e11900" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 20h14l-2 6H29z" fill="#e11900"/></svg>`,
  box: () => `<svg viewBox="0 0 64 40"><path d="M20 6l16-0 10 6v18l-16 4-14-5V10z" fill="#d79b4f"/><path d="M16 10l14 5v19l-14-5z" fill="#b97a33"/><path d="M30 15l16-3v18l-16 4z" fill="#e5ad63"/><path d="M22 8l14 5" stroke="#fff" stroke-width="2"/></svg>`,
};
export const vehicleArt = (iconName) => {
  const el = document.createElement('span');
  el.style.display = 'contents';
  el.innerHTML = (VEHICLES[iconName] || VEHICLES.car)();
  return el;
};

// --- feedback -----------------------------------------------------------------

let toastRoot;
export function toast(text, type = '') {
  toastRoot ??= document.body.appendChild(h('div', { class: 'toasts' }));
  const t = h('div', { class: `toast ${type}` }, text);
  toastRoot.append(t);
  while (toastRoot.children.length > 2) toastRoot.firstChild.remove();
  setTimeout(() => t.remove(), type === 'error' ? 5000 : 3500);
}

export const toastError = (err) => toast(err?.message || String(err), 'error');

export function modal(build, { dismissible = true } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: 'modal', role: 'dialog' });
  let onClose;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  backdrop.append(box);
  if (dismissible) {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
  }
  append(box, [build(close)]);
  document.body.append(backdrop);
  return { close, el: box, set onClose(fn) { onClose = fn; } };
}

export function confirmDialog(title, text, { ok = 'تأیید', cancel = 'انصراف', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal((close) => h('div', {},
      h('h3', {}, title),
      text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'col mt' },
        h('button', { class: `btn btn-lg btn-block ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { resolve(true); close(); } }, ok),
        h('button', { class: 'btn btn-lg btn-block', onclick: () => { resolve(false); close(); } }, cancel)),
    ));
    m.onClose = () => resolve(false);
  });
}

// Disables a button and shows a spinner while the promise runs.
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const old = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spinner' }));
  try {
    return await fn();
  } catch (err) {
    toastError(err);
    return undefined;
  } finally {
    btn.disabled = false;
    btn.replaceChildren(...old);
  }
}

// --- small components ---------------------------------------------------------

export function ratingPill(r) {
  const el = h('span', { class: 'rating-pill' }, num(r, 2));
  el.prepend(icon('star'));
  return el;
}

export function starInput(onChange, initial = 0) {
  const wrap = h('div', { class: 'stars' });
  const btns = [1, 2, 3, 4, 5].map((v) => {
    const b = h('button', { type: 'button', 'aria-label': `${v} ستاره`, onclick: () => set(v) });
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
    return b;
  });
  function set(v) {
    btns.forEach((b, i) => b.classList.toggle('on', i < v));
    onChange(v);
  }
  wrap.append(...btns);
  if (initial) set(initial);
  return wrap;
}

export function plateEl(plate) {
  if (!plate) return h('span');
  const p = plate.split('|');
  if (p.length === 2) return h('span', { class: 'plate bike' }, h('span', {}, faDigits(p[0])), h('span', {}, faDigits(p[1])));
  return h('span', { class: 'plate' },
    h('span', { class: 'p-flag' }, 'I.R.', h('br'), 'IRAN'),
    h('span', { class: 'p-main' }, faDigits(p[0]), h('span', {}, p[1]), faDigits(p[2])),
    h('span', { class: 'p-region' }, h('small', {}, 'ایران'), faDigits(p[3])));
}

export const initials = (name) => (name || '؟').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('‌');
export const avatar = (name, cls = '') => h('div', { class: `avatar ${cls}` }, initials(name));

export function listItem({ iconName, title, sub, onclick, end, href }) {
  return h(href ? 'a' : 'button', { class: 'list-item', onclick, href },
    iconName ? h('span', { class: 'li-icon' }, icon(iconName)) : null,
    h('span', { class: 'li-body' }, h('div', { class: 'li-title' }, title), sub ? h('div', { class: 'li-sub' }, sub) : null),
    end ?? null);
}

// Full-screen page with a back button; returns { body, close }.
export function page(title, { onClose } = {}) {
  const body = h('div', { class: 'page-body' });
  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('button', { class: 'btn-icon flat btn', onclick: () => close(), 'aria-label': 'بازگشت' }, icon('back')), h('h2', {}, title)),
    body);
  function close() { el.remove(); onClose?.(); }
  document.body.append(el);
  return { body, close, el };
}

// Keeps --sheet-h in sync so map controls float above the bottom sheet on phones.
export function trackSheetHeight(sheet) {
  const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`));
  ro.observe(sheet);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('کپی شد'); } catch { toast(text); }
}

export async function shareLink(title, text, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch { /* cancelled */ }
  }
  copyText(url);
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* audio blocked */ }
}

export function notify(title, body) {
  if (document.visibilityState === 'visible' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification(title, { body, icon: '/icon.svg' });
}
