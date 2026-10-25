// Bottom console: autopilot STATUSTEXT and app events as plain log lines.
// Collapsible, resizable by dragging its top edge, auto-follows new lines while scrolled to the bottom.
import type { StatusMessage } from '../vehicle/state';
import type { Vehicle } from '../vehicle/vehicle';
import { h, storage } from './dom';
import { icon } from './icons';

const LEVEL = ['EMERG', 'ALERT', 'CRIT', 'ERROR', 'WARN', 'NOTICE', 'INFO', 'DEBUG'];
const MIN_H = 90;
const DEFAULT_H = 180;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const stamp = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };

export function consolePanel(vehicle: Vehicle): HTMLElement {
  let open = storage.get('console.open', true);
  let height = storage.get('console.height', DEFAULT_H);
  let unread = 0;
  let follow = true;
  let rendered: StatusMessage[] = [];

  const log = h('div', { class: 'console-log', role: 'log', 'aria-live': 'polite', tabindex: 0 });
  const empty = h('div', { class: 'console-empty' }, 'No messages yet. Pre-arm failures, calibration results and link events show up here.');
  const count = h('span', { class: 'console-count' });
  const badge = h('span', { class: 'console-badge', hidden: true });
  const jump = h('button', { class: 'console-jump', type: 'button', hidden: true, title: 'Jump to latest', onclick: () => { log.scrollTop = log.scrollHeight; } }, icon('toBottom', 14), 'Latest');
  const toggleIcon = h('span', { class: 'console-chev' });
  const resize = h('div', { class: 'console-resize', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize console', tabindex: 0 });

  const toggle = h('button', { class: 'console-toggle', type: 'button', 'aria-expanded': String(open), onclick: () => setOpen(!open) },
    icon('terminal', 15), h('span', { class: 'console-title' }, 'Console'), count, badge, toggleIcon);

  const panel = h('section', { class: 'console', 'aria-label': 'Console' },
    resize,
    h('div', { class: 'console-bar' },
      toggle,
      h('div', { class: 'console-actions' },
        jump,
        h('button', { class: 'console-btn', type: 'button', title: 'Clear console', 'aria-label': 'Clear console', onclick: () => vehicle.store.update({ messages: [] }) }, icon('clear', 15)),
        h('button', { class: 'console-btn', type: 'button', title: 'Show or hide', 'aria-label': 'Show or hide console', onclick: () => setOpen(!open) }, h('span', { class: 'console-chev2' })),
      ),
    ),
    h('div', { class: 'console-body' }, empty, log),
  );

  function setOpen(v: boolean) {
    open = v;
    storage.set('console.open', v);
    panel.classList.toggle('is-open', v);
    toggle.setAttribute('aria-expanded', String(v));
    toggleIcon.replaceChildren(icon(v ? 'down' : 'up', 15));
    panel.querySelector('.console-chev2')!.replaceChildren(icon(v ? 'down' : 'up', 15));
    panel.style.setProperty('--console-h', `${height}px`);
    if (v) { unread = 0; updateBadge(); log.scrollTop = log.scrollHeight; }
  }

  function updateBadge() {
    badge.hidden = unread === 0;
    badge.textContent = `${unread} new`;
  }

  // Drag the top edge to resize; keyboard arrows too.
  resize.addEventListener('pointerdown', (e) => {
    if (!open) setOpen(true);
    const startY = e.clientY, startH = height;
    resize.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const max = Math.max(MIN_H, window.innerHeight * 0.7);
      height = Math.round(Math.min(max, Math.max(MIN_H, startH + (startY - ev.clientY))));
      panel.style.setProperty('--console-h', `${height}px`);
    };
    const up = () => { resize.removeEventListener('pointermove', move); storage.set('console.height', height); };
    resize.addEventListener('pointermove', move);
    resize.addEventListener('pointerup', up, { once: true });
    resize.addEventListener('pointercancel', up, { once: true });
  });
  resize.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    height = Math.max(MIN_H, height + (e.key === 'ArrowUp' ? 24 : -24));
    storage.set('console.height', height);
    panel.style.setProperty('--console-h', `${height}px`);
  });

  log.addEventListener('scroll', () => {
    follow = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    jump.hidden = follow;
  });

  const line = (m: StatusMessage) => h('div', { class: `cl sev-${m.severity}${m.source === 'app' ? ' cl-app' : ''}` },
    h('span', { class: 'cl-time' }, stamp(m.time)),
    h('span', { class: 'cl-lvl' }, m.source === 'app' ? 'APP' : LEVEL[m.severity] ?? String(m.severity)),
    h('span', { class: 'cl-text' }, m.text));

  vehicle.store.subscribe((s) => {
    if (s.messages === rendered) return;
    const appended = s.messages.length >= rendered.length && rendered.every((m, i) => s.messages[i] === m);
    const fresh = appended ? s.messages.slice(rendered.length) : s.messages;
    if (!appended) log.replaceChildren();
    log.append(...fresh.map(line));
    // keep the DOM bounded like the store
    while (log.childElementCount > 1000) log.firstElementChild!.remove();
    if (!open) { unread += fresh.filter((m) => m.severity <= 4).length; updateBadge(); }
    if (follow) log.scrollTop = log.scrollHeight;
    rendered = s.messages;
    empty.hidden = s.messages.length > 0;
    const warn = s.messages.filter((m) => m.severity <= 4).length;
    count.textContent = s.messages.length ? `${s.messages.length}${warn ? ` · ${warn} warning${warn === 1 ? '' : 's'}` : ''}` : '';
  });

  setOpen(open);
  return panel;
}
