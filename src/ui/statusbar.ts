// Top bar: link, vehicle, mode, arm state, GPS, battery, EKF.
import { modeTable, QUICK_MODES } from '../vehicle/modes';
import type { VehicleState } from '../vehicle/state';
import { resultName, type Vehicle } from '../vehicle/vehicle';
import { MAV_RESULT } from '../mavlink/generated';
import { confirmDialog } from './dialog';
import { h } from './dom';
import { openConnectDialog } from './connect';
import { toast } from './toast';

const GPS_FIX = ['No GPS', 'No fix', '2D', '3D', 'DGPS', 'RTK float', 'RTK fixed', 'Static', 'PPP'];

export function statusBar(vehicle: Vehicle): HTMLElement {
  const linkDot = h('span', { class: 'dot' });
  const linkText = h('span', { class: 'link-text' });
  const vehicleText = h('span', { class: 'vehicle-text' });
  const modeSel = h('select', { class: 'mode-select', 'aria-label': 'Flight mode', disabled: true });
  const armBtn = h('button', { class: 'arm-btn', type: 'button', disabled: true });
  const gps = h('span', { class: 'chip' });
  const batt = h('span', { class: 'chip' });
  const ekf = h('span', { class: 'chip' });
  const connectBtn = h('button', { class: 'btn btn-primary connect-btn', type: 'button' });

  connectBtn.addEventListener('click', () => {
    if (vehicle.store.state.link === 'disconnected') openConnectDialog(vehicle);
    else void vehicle.disconnect();
  });

  let modeKey = '';
  modeSel.addEventListener('change', async () => {
    const mode = Number(modeSel.value);
    const r = await vehicle.setMode(mode).catch((e: Error) => { toast(e.message, 'error'); return -1; });
    if (r >= 0 && r !== MAV_RESULT.MAV_RESULT_ACCEPTED) toast(`Mode change ${resultName(r)}`, 'warn');
  });

  armBtn.addEventListener('click', async () => {
    const armed = vehicle.store.state.armed;
    if (!armed && !(await confirmDialog('Arm motors?', 'Props should be off or the vehicle secured. Motors may spin as soon as it arms.', 'Arm', true))) return;
    const r = await vehicle.arm(!armed).catch((e: Error) => { toast(e.message, 'error'); return -1; });
    if (r >= 0 && r !== MAV_RESULT.MAV_RESULT_ACCEPTED) toast(`${armed ? 'Disarm' : 'Arm'} ${resultName(r)} — see Messages for the reason`, 'warn');
  });

  const bar = h('header', { class: 'statusbar' },
    h('div', { class: 'brand' }, 'WebPlanner'),
    h('div', { class: 'link' }, linkDot, linkText),
    vehicleText,
    modeSel,
    armBtn,
    h('div', { class: 'chips' }, gps, batt, ekf),
    connectBtn,
  );

  vehicle.store.subscribe((s: VehicleState) => {
    const live = s.link === 'connected' || s.link === 'lost';
    bar.dataset.link = s.link;
    linkText.textContent = {
      disconnected: s.linkError ? `Disconnected — ${s.linkError}` : 'Not connected',
      connecting: `Opening ${s.linkLabel}…`,
      waiting: `${s.linkLabel} · waiting for heartbeat`,
      connected: s.linkLabel,
      lost: `${s.linkLabel} · link lost`,
    }[s.link];
    connectBtn.textContent = s.link === 'disconnected' ? 'Connect' : 'Disconnect';
    vehicleText.textContent = live ? (s.firmware || s.vehicleClass) : '';

    const key = `${s.vehicleClass}`;
    if (key !== modeKey) {
      modeKey = key;
      const table = modeTable(s.vehicleClass);
      const quick = QUICK_MODES[s.vehicleClass];
      const rest = Object.keys(table).map(Number).filter((m) => !quick.includes(m));
      modeSel.replaceChildren(
        ...quick.map((m) => h('option', { value: String(m) }, table[m])),
        ...(rest.length ? [h('option', { disabled: true }, '──────')] : []),
        ...rest.map((m) => h('option', { value: String(m) }, table[m])),
      );
    }
    if (live && !modeSel.querySelector(`option[value="${s.customMode}"]`)) {
      modeSel.append(h('option', { value: String(s.customMode) }, s.modeName));
    }
    if (document.activeElement !== modeSel) modeSel.value = String(s.customMode);
    modeSel.disabled = s.link !== 'connected';

    armBtn.disabled = s.link !== 'connected';
    armBtn.textContent = live ? (s.armed ? 'Armed' : 'Disarmed') : '—';
    armBtn.classList.toggle('is-armed', live && s.armed);
    armBtn.title = s.armed ? 'Click to disarm' : 'Click to arm';

    gps.textContent = live ? `${GPS_FIX[s.gpsFix] ?? 'GPS'} · ${s.gpsSats} sats` : 'GPS';
    gps.dataset.level = !live ? '' : s.gpsFix >= 3 ? 'ok' : s.gpsFix >= 2 ? 'warn' : 'bad';
    batt.textContent = live && s.batteryVoltage > 0
      ? `${s.batteryVoltage.toFixed(1)} V${s.batteryRemaining >= 0 ? ` · ${s.batteryRemaining}%` : ''}`
      : 'Battery';
    batt.dataset.level = !live || s.batteryVoltage <= 0 ? '' : s.batteryRemaining >= 0 && s.batteryRemaining < 20 ? 'bad' : 'ok';
    ekf.textContent = 'EKF';
    ekf.dataset.level = !live || s.ekfOk === null ? '' : s.ekfOk ? 'ok' : 'bad';
  });
  return bar;
}
