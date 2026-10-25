// Top band: link, vehicle, and read-only health indicators.
import type { VehicleState } from '../vehicle/state';
import { vehicleTypeName } from '../vehicle/modes';
import type { Vehicle } from '../vehicle/vehicle';
import { h, storage } from './dom';
import { openConnectDialog } from './connect';
import { icon } from './icons';

const GPS_FIX = ['No GPS', 'No fix', '2D fix', '3D fix', 'DGPS', 'RTK float', 'RTK fixed', 'Static', 'PPP'];

export function statusBar(vehicle: Vehicle, onReboot: () => void): HTMLElement {
  const linkText = h('span', { class: 'link-text' });
  const linkSub = h('span', { class: 'link-sub' });
  const vehicleName = h('span', { class: 'veh-name' });
  const vehicleSub = h('span', { class: 'veh-sub' });

  const chip = (name: Parameters<typeof icon>[0]) => {
    const label = h('span', null);
    const el = h('span', { class: 'chip' }, icon(name, 16), label);
    return { el, label };
  };
  const mode = h('span', { class: 'chip chip-mode' });
  const armed = h('span', { class: 'chip chip-armed', hidden: true }, icon('armed', 16), 'Armed');
  const gps = chip('satellite');
  const batt = chip('battery');
  const ekf = chip('ekfOk');

  const rebootBtn = h('button', { class: 'btn connect-btn reboot-btn', type: 'button', title: 'Reboot the flight controller', hidden: true, onclick: onReboot },
    icon('power'), h('span', null, 'Reboot'));
  const connectBtn = h('button', { class: 'btn connect-btn', type: 'button' });
  connectBtn.addEventListener('click', () => {
    if (vehicle.store.state.link === 'disconnected') openConnectDialog(vehicle);
    else { storage.set('autoUsb', null); void vehicle.disconnect(); } // a deliberate disconnect stops auto-connect
  });

  const bar = h('header', { class: 'statusbar' },
    h('div', { class: 'brand' }, h('img', { src: `${import.meta.env.BASE_URL}favicon.svg`, alt: '', width: 28, height: 28 }), h('span', null, 'WebPlanner')),
    h('div', { class: 'link' }, h('span', { class: 'dot' }), h('div', { class: 'stack' }, linkText, linkSub)),
    h('div', { class: 'veh' }, h('div', { class: 'stack' }, vehicleName, vehicleSub)),
    h('div', { class: 'chips' }, armed, mode, gps.el, batt.el, ekf.el),
    h('div', { class: 'bar-actions' }, rebootBtn, connectBtn),
  );

  // Only touch the DOM when something visible changed (this runs on every telemetry frame).
  const last: Record<string, string> = {};
  const changed = (k: string, v: string) => (last[k] === v ? false : ((last[k] = v), true));
  const text = (el: HTMLElement, v: string) => { if (el.textContent !== v) el.textContent = v; };

  vehicle.store.subscribe((s: VehicleState) => {
    const live = s.link === 'connected' || s.link === 'lost';
    bar.dataset.link = s.link;
    text(linkText, {
      disconnected: 'Not connected',
      connecting: 'Connecting…',
      waiting: 'Waiting for vehicle…',
      connected: 'Connected',
      lost: 'Link lost',
    }[s.link]);
    text(linkSub, s.link === 'disconnected' ? (s.linkError ?? 'USB or network') : s.linkLabel);
    linkSub.title = linkSub.textContent ?? '';

    bar.classList.toggle('is-live', live);
    text(vehicleName, live ? (s.firmware || 'ArduPilot') : '');
    text(vehicleSub, live ? `${vehicleTypeName(s.mavType)} · system ${s.sysid}` : '');

    if (changed('btn', String(s.link === 'disconnected'))) {
      connectBtn.replaceChildren(
        icon(s.link === 'disconnected' ? 'plug' : 'unplug'),
        h('span', null, s.link === 'disconnected' ? 'Connect' : 'Disconnect'),
      );
      connectBtn.classList.toggle('btn-accent', s.link === 'disconnected');
    }

    for (const c of [mode, gps.el, batt.el, ekf.el]) c.hidden = !live;
    rebootBtn.hidden = s.link !== 'connected';
    armed.hidden = !(live && s.armed);
    text(mode, s.modeName);

    text(gps.label, `${GPS_FIX[s.gpsFix] ?? 'GPS'} · ${s.gpsSats}`);
    gps.el.dataset.level = s.gpsFix >= 3 ? 'ok' : s.gpsFix >= 2 ? 'warn' : 'bad';
    gps.el.title = `GPS: ${GPS_FIX[s.gpsFix] ?? s.gpsFix}, ${s.gpsSats} satellites, HDOP ${s.gpsHdop.toFixed(1)}`;

    text(batt.label, s.batteryVoltage > 0
      ? `${s.batteryVoltage.toFixed(1)} V${s.batteryRemaining >= 0 ? ` · ${s.batteryRemaining}%` : ''}` : 'No battery');
    batt.el.dataset.level = s.batteryVoltage <= 0 ? '' : s.batteryRemaining >= 0 && s.batteryRemaining < 20 ? 'bad' : 'ok';

    if (changed('ekf', String(s.ekfOk))) ekf.el.replaceChildren(icon(s.ekfOk === false ? 'ekfBad' : 'ekfOk', 16), h('span', null, 'EKF'));
    ekf.el.dataset.level = s.ekfOk === null ? '' : s.ekfOk ? 'ok' : 'bad';
    ekf.el.title = s.ekfOk === null ? 'EKF status unknown' : s.ekfOk ? 'EKF healthy' : 'EKF not ready — check the Messages tab';
  });
  return bar;
}
