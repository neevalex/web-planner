// Connection dialog: USB (Web Serial) or network (UDP/TCP through the bridge).
import { SerialTransport, serialSupported } from '../transport/serial';
import { WebSocketTransport, type NetTarget } from '../transport/websocket';
import type { Vehicle } from '../vehicle/vehicle';
import { modal } from './dialog';
import { h, storage } from './dom';
import { toast } from './toast';

interface Saved {
  tab: 'usb' | 'net';
  baud: number;
  bridge: string;
  netKind: 'udp-listen' | 'udp' | 'tcp';
  udpPort: number;
  host: string;
  port: number;
}

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000];

export function openConnectDialog(vehicle: Vehicle) {
  const s = storage.get<Saved>('connect', {
    tab: serialSupported() ? 'usb' : 'net', baud: 115200,
    bridge: 'ws://localhost:8765', netKind: 'udp-listen', udpPort: 14550, host: '127.0.0.1', port: 5760,
  });

  const tabUsb = h('button', { class: 'seg', role: 'tab', type: 'button' }, 'USB');
  const tabNet = h('button', { class: 'seg', role: 'tab', type: 'button' }, 'Network');

  // USB panel
  const baud = h('select', { id: 'c-baud' }, BAUDS.map((b) => h('option', { value: String(b), selected: b === s.baud }, String(b))));
  const usbPanel = h('div', { class: 'form' },
    serialSupported()
      ? h('p', { class: 'hint' }, 'Plug the flight controller in, then choose its port. Use 115200 for USB, or the SERIALx_BAUD of a telemetry radio.')
      : h('p', { class: 'hint hint-warn' }, 'This browser has no Web Serial. Use Chrome or Edge on a computer, or connect over the network.'),
    h('label', { for: 'c-baud' }, 'Baud rate'), baud,
  );

  // Network panel
  const bridge = h('input', { id: 'c-bridge', value: s.bridge, spellcheck: false, autocomplete: 'off' });
  const kind = h('select', { id: 'c-kind' },
    h('option', { value: 'udp-listen', selected: s.netKind === 'udp-listen' }, 'UDP — listen for the vehicle'),
    h('option', { value: 'udp', selected: s.netKind === 'udp' }, 'UDP — send to address'),
    h('option', { value: 'tcp', selected: s.netKind === 'tcp' }, 'TCP — connect to address'),
  );
  const udpPort = h('input', { id: 'c-udpport', type: 'number', min: 1, max: 65535, value: String(s.udpPort) });
  const host = h('input', { id: 'c-host', value: s.host, spellcheck: false, autocomplete: 'off' });
  const port = h('input', { id: 'c-port', type: 'number', min: 1, max: 65535, value: String(s.port) });
  const listenRow = h('div', { class: 'field' }, h('label', { for: 'c-udpport' }, 'Local UDP port'), udpPort);
  const addrRow = h('div', { class: 'field-row' },
    h('div', { class: 'field grow' }, h('label', { for: 'c-host' }, 'Host'), host),
    h('div', { class: 'field' }, h('label', { for: 'c-port' }, 'Port'), port),
  );
  const netPanel = h('div', { class: 'form' },
    h('p', { class: 'hint' }, 'Browsers can’t open UDP or TCP sockets, so network links go through the WebPlanner bridge (run it on this computer, a Pi, or a server).'),
    h('label', { for: 'c-bridge' }, 'Bridge address'), bridge,
    h('label', { for: 'c-kind' }, 'Link'), kind,
    listenRow, addrRow,
    h('p', { class: 'hint' }, 'SITL: TCP 127.0.0.1:5760, or UDP listen 14550. Herelink / most telemetry: UDP listen 14550.'),
  );

  const syncKind = () => {
    listenRow.hidden = kind.value !== 'udp-listen';
    addrRow.hidden = kind.value === 'udp-listen';
    if (kind.value === 'tcp' && port.value === '14550') port.value = '5760';
    if (kind.value === 'udp' && port.value === '5760') port.value = '14550';
  };
  kind.addEventListener('change', syncKind);
  syncKind();

  let tab = s.tab;
  const setTab = (t: 'usb' | 'net') => {
    tab = t;
    tabUsb.setAttribute('aria-selected', String(t === 'usb'));
    tabNet.setAttribute('aria-selected', String(t === 'net'));
    usbPanel.hidden = t !== 'usb';
    netPanel.hidden = t !== 'net';
  };
  tabUsb.addEventListener('click', () => setTab('usb'));
  tabNet.addEventListener('click', () => setTab('net'));
  setTab(tab);

  const go = h('button', { class: 'btn btn-primary', type: 'button' }, 'Connect');
  const m = modal('Connect to vehicle', h('div', null,
    h('div', { class: 'segmented', role: 'tablist' }, tabUsb, tabNet),
    usbPanel, netPanel,
  ), [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), go]);

  go.addEventListener('click', async () => {
    const saved: Saved = {
      tab, baud: Number(baud.value), bridge: bridge.value.trim(), netKind: kind.value as Saved['netKind'],
      udpPort: Number(udpPort.value), host: host.value.trim(), port: Number(port.value),
    };
    storage.set('connect', saved);
    let transport;
    if (tab === 'usb') {
      if (!serialSupported()) { toast('Web Serial isn’t available in this browser.', 'error'); return; }
      transport = new SerialTransport(saved.baud);
    } else {
      const target: NetTarget = saved.netKind === 'udp-listen'
        ? { kind: 'udp-listen', port: saved.udpPort }
        : { kind: saved.netKind, host: saved.host, port: saved.port };
      transport = new WebSocketTransport(saved.bridge, target);
    }
    go.disabled = true;
    go.textContent = 'Connecting…';
    try {
      await vehicle.connect(transport); // serial port picker opens here (needs the click gesture)
      m.close();
    } catch (e) {
      const msg = (e as Error).message;
      if (!/No port selected/i.test(msg)) toast(msg, 'error');
      go.disabled = false;
      go.textContent = 'Connect';
    }
  });
}
