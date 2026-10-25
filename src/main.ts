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
import { consolePanel } from './ui/console';
import { toast } from './ui/toast';
import { icon, type IconName } from './ui/icons';
import { MetaStore } from './ui/meta';
import { Staging } from './ui/staging';
import { writeTray } from './ui/tray';
import { Ctx, type Page } from './ui/setup/kit';
import { BasicPage } from './ui/setup/basicPage';
import { RadioPage } from './ui/setup/radioPage';
import { ChannelsPage } from './ui/setup/channelsPage';
import { CompassPage } from './ui/setup/compassPage';
import { MotorsPage } from './ui/setup/motorsPage';
import { FailsafePage } from './ui/setup/failsafePage';
import { OsdPage } from './ui/setup/osdPage';
import { BatteryPage } from './ui/setup/batteryPage';
import { SerialTransport, findRememberedPort, serialSupported, type RememberedPort } from './transport/serial';

const vehicle = new Vehicle();
(window as unknown as { vehicle: Vehicle }).vehicle = vehicle; // handy in devtools
const meta = new MetaStore(vehicle);
const staging = new Staging(vehicle, meta);
const ctx = () => new Ctx(vehicle, staging, meta);

const params = new ParamsView(vehicle, staging);
const pages: Record<string, Page> = {
  basic: new BasicPage(ctx()), radio: new RadioPage(ctx()), channels: new ChannelsPage(ctx()), motors: new MotorsPage(ctx()),
  compass: new CompassPage(ctx()), battery: new BatteryPage(ctx()), failsafe: new FailsafePage(ctx()), osd: new OsdPage(ctx()),
};
const views: Record<string, HTMLElement> = {
  ...Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.el])),
  params: params.el, status: statusView(vehicle),
};

type NavItem = [string, string, IconName] | 'sep';
const navItems: NavItem[] = [
  ['basic', 'Basic', 'wrench'], ['radio', 'Radio', 'radio'], ['channels', 'Channels', 'channels'], ['motors', 'Motors', 'motors'],
  ['compass', 'Compass', 'compass'], ['battery', 'Battery', 'battery'], ['failsafe', 'Failsafe', 'failsafe'], ['osd', 'OSD', 'osd'],
  'sep',
  ['params', 'Parameters', 'params'], ['status', 'Status', 'gauge'],
];
const { tray, reboot } = writeTray(staging, () => { show('params'); params.showModified(); });
const viewHost = h('div', { class: 'view-host' });
const main = h('main', { class: 'main' }, reboot, h('div', { class: 'stage' }, viewHost, tray), consolePanel(vehicle));
const navButtons = new Map<string, HTMLButtonElement>();
const nav = h('nav', { class: 'rail', 'aria-label': 'Sections' },
  navItems.map((item) => {
    if (item === 'sep') return h('span', { class: 'rail-sep', 'aria-hidden': 'true' });
    const [key, label, ic] = item;
    const b = h('button', { type: 'button', class: 'rail-btn', onclick: () => show(key) },
      h('span', { class: 'rail-icon' }, icon(ic, 22)), h('span', { class: 'rail-label' }, label));
    navButtons.set(key, b);
    return b;
  }));

let current = '';
function show(key: string) {
  if (!(key in views)) key = 'basic';
  if (key === current) return;
  pages[current]?.onHide();
  current = key;
  storage.set('view', key);
  for (const [k, b] of navButtons) b.setAttribute('aria-current', k === key ? 'page' : 'false');
  viewHost.replaceChildren(views[key]);
  viewHost.scrollTop = 0;
  if (vehicle.connected) pages[key]?.onShow();
}

document.querySelector('#app')!.append(statusBar(vehicle), h('div', { class: 'shell' }, nav, main));
show(storage.get<string>('view', 'basic'));

// Pages that need faster telemetry ask for it once the vehicle is up.
let wasConnected = false;
vehicle.store.subscribe(() => {
  if (vehicle.connected && !wasConnected && vehicle.params.progress.done) pages[current]?.onShow();
  wasConnected = vehicle.connected && vehicle.params.progress.done;
});
vehicle.params.onUpdate(() => {
  if (vehicle.connected && vehicle.params.progress.done && !wasConnected) { wasConnected = true; pages[current]?.onShow(); }
});

// ---------- USB auto-connect ----------
// Chrome keeps permission for ports picked before, so they can be reopened without a click.
async function autoConnect(reason: string) {
  const remembered = storage.get<RememberedPort | null>('autoUsb', null);
  if (!remembered || !serialSupported() || vehicle.store.state.link !== 'disconnected') return;
  const port = await findRememberedPort(remembered);
  if (!port) return;
  vehicle.log(`${reason}: reconnecting to the last USB port`);
  try { await vehicle.connect(new SerialTransport(remembered.baud, port)); }
  catch (e) { vehicle.log(`Auto-connect failed: ${(e as Error).message}`, 4); }
}
void autoConnect('App opened');
if (serialSupported()) navigator.serial.addEventListener('connect', () => { setTimeout(() => void autoConnect('USB device plugged in'), 600); });

// Link events: toast the important ones, log all of them to the console.
let lastLink = vehicle.store.state.link;
vehicle.store.subscribe((s) => {
  if (s.link === lastLink) return;
  if (s.link === 'connecting') vehicle.log(`Opening ${s.linkLabel}`);
  if (s.link === 'waiting') vehicle.log(`${s.linkLabel} open, waiting for heartbeat`);
  if (s.link === 'connected' && lastLink !== 'lost') vehicle.log(`Connected to system ${s.sysid} (${s.linkLabel})`);
  if (s.link === 'lost') { toast('Heartbeat lost — check the link', 'warn'); vehicle.log('Heartbeat lost', 4); }
  if (s.link === 'connected' && lastLink === 'lost') { toast('Link restored', 'ok'); vehicle.log('Link restored'); }
  if (s.link === 'disconnected') {
    if (s.linkError && lastLink !== 'connecting') toast(s.linkError, 'error');
    vehicle.log(s.linkError ? `Disconnected: ${s.linkError}` : 'Disconnected', s.linkError ? 3 : 6);
  }
  lastLink = s.link;
});

let firmwareLogged = '';
vehicle.store.subscribe((s) => {
  if (s.firmware && s.firmware !== firmwareLogged) { firmwareLogged = s.firmware; vehicle.log(`Firmware ${s.firmware}`); }
});

window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('.tray:not([hidden])')) e.preventDefault();
});
