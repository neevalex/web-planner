import { h } from './dom';
import { icon, type IconName } from './icons';

type Kind = 'info' | 'ok' | 'warn' | 'error';
const ICON: Record<Kind, IconName> = { info: 'info', ok: 'check', warn: 'warn', error: 'alert' };

let host: HTMLElement | null = null;

export function toast(text: string, kind: Kind = 'info', ms = kind === 'error' ? 7000 : kind === 'ok' ? 2500 : 3500) {
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  // Keep at most four on screen.
  while (host.children.length >= 4) host.firstElementChild!.remove();
  const el = h('div', { class: `toast toast-${kind}` }, icon(ICON[kind]), h('span', null, text));
  el.addEventListener('click', () => el.remove());
  host.append(el);
  setTimeout(() => el.remove(), ms);
}
