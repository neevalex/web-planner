import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';

import { Vehicle } from './vehicle/vehicle';
import { h, storage } from './ui/dom';
import { statusBar } from './ui/statusbar';
import { ParamsView } from './ui/params/paramsView';
import { statusView } from './ui/statusView';
import { messagesView } from './ui/messagesView';
import { toast } from './ui/toast';
import { icon, type IconName } from './ui/icons';

const vehicle = new Vehicle();
(window as unknown as { vehicle: Vehicle }).vehicle = vehicle; // handy in devtools

type ViewKey = 'params' | 'status' | 'messages';

const params = new ParamsView(vehicle);
const msgBadge = h('span', { class: 'badge', hidden: true });
const messages = messagesView(vehicle, (n) => { msgBadge.hidden = n === 0; msgBadge.textContent = String(n); });
const views: Record<ViewKey, HTMLElement> = { params: params.el, status: statusView(vehicle), messages: messages.el };

const navItems: [ViewKey, string, IconName, Node?][] = [
  ['params', 'Parameters', 'params'], ['status', 'Status', 'gauge'], ['messages', 'Messages', 'messages', msgBadge],
];
const main = h('main', { class: 'main' });
const navButtons = new Map<ViewKey, HTMLButtonElement>();
const nav = h('nav', { class: 'rail', 'aria-label': 'Sections' },
  navItems.map(([key, label, ic, extra]) => {
    const b = h('button', { type: 'button', class: 'rail-btn', onclick: () => show(key) },
      h('span', { class: 'rail-icon' }, icon(ic, 22), extra ?? null), h('span', { class: 'rail-label' }, label));
    navButtons.set(key, b);
    return b;
  }));

function show(key: ViewKey) {
  storage.set('view', key);
  for (const [k, b] of navButtons) b.setAttribute('aria-current', k === key ? 'page' : 'false');
  main.replaceChildren(views[key]);
  if (key === 'messages') messages.markRead();
}

document.querySelector('#app')!.append(statusBar(vehicle), h('div', { class: 'shell' }, nav, main));
show(storage.get<ViewKey>('view', 'params'));

// Surface link problems once, not on every frame.
let lastLink = vehicle.store.state.link;
vehicle.store.subscribe((s) => {
  if (s.link === lastLink) return;
  if (s.link === 'lost') toast('Heartbeat lost — check the link', 'warn');
  if (s.link === 'connected' && lastLink === 'lost') toast('Link restored', 'ok');
  if (s.link === 'disconnected' && s.linkError && lastLink !== 'connecting') toast(s.linkError, 'error');
  lastLink = s.link;
});

window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('.tray:not([hidden])')) e.preventDefault();
});
