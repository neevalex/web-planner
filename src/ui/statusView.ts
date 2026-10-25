// Status page: attitude indicator plus the numbers you check on the bench.
import type { VehicleState } from '../vehicle/state';
import { vehicleTypeName } from '../vehicle/modes';
import type { Vehicle } from '../vehicle/vehicle';
import { h } from './dom';

export function statusView(vehicle: Vehicle): HTMLElement {
  const canvas = h('canvas', { class: 'hud', width: 480, height: 480, 'aria-label': 'Attitude indicator', role: 'img' });
  const cells = new Map<string, HTMLElement>();
  const cell = (key: string, label: string) => {
    const v = h('span', { class: 'tval' }, '—');
    cells.set(key, v);
    return h('div', { class: 'tcell' }, h('span', { class: 'tlabel' }, label), v);
  };
  const grid = h('div', { class: 'tgrid' },
    cell('roll', 'Roll'), cell('pitch', 'Pitch'), cell('heading', 'Heading'),
    cell('altRel', 'Altitude (rel)'), cell('gs', 'Ground speed'), cell('climb', 'Climb'),
    cell('gps', 'GPS'), cell('pos', 'Position'), cell('home', 'Home distance'),
    cell('volt', 'Battery'), cell('curr', 'Current'), cell('thr', 'Throttle'),
    cell('type', 'Vehicle'), cell('sys', 'System ID'), cell('link', 'Link'),
  );
  const el = h('section', { class: 'view status-view', 'aria-label': 'Status' },
    h('div', { class: 'hud-wrap' }, canvas), grid);

  const set = (k: string, v: string) => { const c = cells.get(k); if (c && c.textContent !== v) c.textContent = v; };
  const deg = (r: number) => (r * 180) / Math.PI;

  vehicle.store.subscribe((s: VehicleState) => {
    const live = s.link === 'connected' || s.link === 'lost';
    el.classList.toggle('is-offline', !live);
    drawHud(canvas, s, live);
    if (!live) { for (const c of cells.values()) c.textContent = '—'; return; }
    set('roll', `${deg(s.roll).toFixed(1)}°`);
    set('pitch', `${deg(s.pitch).toFixed(1)}°`);
    set('heading', `${Math.round(s.heading)}°`);
    set('altRel', `${s.altRel.toFixed(1)} m`);
    set('gs', `${s.groundspeed.toFixed(1)} m/s`);
    set('climb', `${s.climb.toFixed(1)} m/s`);
    set('gps', `fix ${s.gpsFix}, ${s.gpsSats} sats, hdop ${s.gpsHdop.toFixed(1)}`);
    set('pos', s.lat !== null ? `${s.lat.toFixed(6)}, ${s.lon!.toFixed(6)}` : 'no position');
    set('home', s.distToHome !== null ? `${s.distToHome.toFixed(0)} m` : 'home not set');
    set('volt', s.batteryVoltage > 0 ? `${s.batteryVoltage.toFixed(2)} V${s.batteryRemaining >= 0 ? ` (${s.batteryRemaining}%)` : ''}` : 'no monitor');
    set('curr', s.batteryCurrent >= 0 ? `${s.batteryCurrent.toFixed(1)} A` : '—');
    set('thr', `${s.throttle}%`);
    set('type', vehicleTypeName(s.mavType));
    set('sys', `${s.sysid} / ${s.compid}`);
    set('link', `${(s.rxRate / 1024).toFixed(1)} kB/s in, ${s.packetLoss.toFixed(1)}% loss`);
  });
  return el;
}

function cssVar(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawHud(c: HTMLCanvasElement, s: VehicleState, live: boolean) {
  const dpr = window.devicePixelRatio || 1;
  const size = c.clientWidth || 320;
  if (c.width !== size * dpr) { c.width = size * dpr; c.height = size * dpr; }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = size / 2;
  g.clearRect(0, 0, size, size);
  g.save();
  g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.clip();

  const pxPerDeg = size / 70;
  const roll = live ? s.roll : 0, pitchDeg = live ? (s.pitch * 180) / Math.PI : 0;
  g.translate(r, r);
  g.rotate(-roll);
  g.translate(0, pitchDeg * pxPerDeg);
  g.fillStyle = cssVar('--hud-sky'); g.fillRect(-size * 2, -size * 4, size * 4, size * 4);
  g.fillStyle = cssVar('--hud-ground'); g.fillRect(-size * 2, 0, size * 4, size * 4);
  g.strokeStyle = cssVar('--hud-line'); g.fillStyle = cssVar('--hud-line');
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(-size * 2, 0); g.lineTo(size * 2, 0); g.stroke();
  g.font = `600 ${Math.round(size / 28)}px Barlow, sans-serif`;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  for (let p = -60; p <= 60; p += 5) {
    if (!p) continue;
    const y = -p * pxPerDeg;
    const w = p % 10 === 0 ? size * 0.16 : size * 0.07;
    g.lineWidth = p % 10 === 0 ? 1.5 : 1;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
    if (p % 10 === 0) g.fillText(String(Math.abs(p)), w + 6, y);
  }
  g.restore();

  // Fixed aircraft symbol
  g.strokeStyle = cssVar('--amber'); g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(r - size * 0.22, r); g.lineTo(r - size * 0.07, r); g.lineTo(r, r + size * 0.04);
  g.lineTo(r + size * 0.07, r); g.lineTo(r + size * 0.22, r);
  g.stroke();

  // Roll scale
  g.save(); g.translate(r, r);
  g.strokeStyle = cssVar('--hud-line'); g.lineWidth = 2;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const rad = (a * Math.PI) / 180 - Math.PI / 2;
    const r1 = r - 4, r2 = r - (a % 30 === 0 ? 18 : 11);
    g.beginPath(); g.moveTo(Math.cos(rad) * r1, Math.sin(rad) * r1); g.lineTo(Math.cos(rad) * r2, Math.sin(rad) * r2); g.stroke();
  }
  g.rotate(-roll);
  g.fillStyle = cssVar('--amber');
  g.beginPath(); g.moveTo(0, -r + 20); g.lineTo(-8, -r + 32); g.lineTo(8, -r + 32); g.closePath(); g.fill();
  g.restore();

  // Rim
  g.strokeStyle = cssVar('--line-strong'); g.lineWidth = 2;
  g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.stroke();

  if (!live) {
    g.fillStyle = cssVar('--hud-veil');
    g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.fill();
  }
}
