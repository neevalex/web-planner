import { h } from './dom';

type Kind = 'info' | 'ok' | 'warn' | 'error';

let host: HTMLElement | null = null;

export function toast(text: string, kind: Kind = 'info', ms = kind === 'error' ? 7000 : kind === 'ok' ? 2500 : 3500) {
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const el = h('div', { class: `toast toast-${kind}` }, text);
  el.addEventListener('click', () => el.remove());
  host.append(el);
  setTimeout(() => el.remove(), ms);
}
