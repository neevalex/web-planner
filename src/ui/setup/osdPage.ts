// OSD: settings and a drag-and-drop screen builder for OSDn_<ITEM>_EN/_X/_Y.
import { clear, h, storage } from '../dom';
import { icon } from '../icons';
import { card, field, fieldsCard, grid, Page, type Ctx } from './kit';

/** Preview text per OSD element; widths approximate ArduPilot's rendering. */
const SAMPLE: Record<string, string> = {
  ALTITUDE: '120m', BAT_VOLT: '16.4V', RSSI: 'RS99', CURRENT: '12.3A', BATUSED: '850mAh', SATS: 'SAT14', FLTMODE: 'STAB',
  MESSAGE: 'PreArm: Need 3D Fix', GSPEED: '42km/h', HORIZON: '-- -- ^ -- --', HOME: '>230m', HEADING: '270', THROTTLE: '45%',
  COMPASS: 'W--N--E', WIND: 'W3m/s', ASPEED: 'AS50', VSPEED: '+2.1', ESCTEMP: '45C', ESCRPM: '12kRPM', ESCAMPS: '8A',
  GPSLAT: '50.45012', GPSLONG: '30.52340', ROLL: 'R12', PITCH: 'P-4', TEMP: '24C', HDOP: 'HD0.8', WAYPOINT: 'WP3 120m',
  XTRACK: 'XT2m', DIST: '1.2km', STATS: 'FLIGHT STATS', FLTIME: '05:32', CLIMBEFF: '12m/Ah', EFF: '120mAh/km', BTEMP: '31C',
  ATEMP: '22C', BAT2_VLT: '8.2V', BAT2USED: '210mAh', ASPD2: 'A2 48', ASPD1: 'A1 50', CLK: '14:05', SIDEBARS: '|        |',
  CRSSHAIR: '-+-', HOMEDIST: 'H230m', HOMEDIR: '^', POWER: '250W', CELLVOLT: '4.10V', BATTBAR: '[######  ]', ARMING: 'ARMED',
  PLUSCODE: '9G4X+22', CALLSIGN: 'CALLSIGN', CURRENT2: '3.1A', VTX_PWR: '25mW', TER_HGT: 'T80m', AVGCELLV: '3.85V',
  RESTVOLT: '15.9V', FENCE: 'FENCE', RNGF: 'RF1.2m', ACRVOLT: '3.80V', RPM: '9500', LINK_Q: 'LQ100',
};

const RES: Record<string, { cols: number; rows: number; label: string }> = {
  pal: { cols: 30, rows: 16, label: 'SD PAL 30×16' },
  ntsc: { cols: 30, rows: 13, label: 'SD NTSC 30×13' },
  hd: { cols: 50, rows: 18, label: 'HD 50×18' },
};

interface Item { key: string; en: string; x: string; y: string }

export class OsdPage extends Page {
  private screen = 1;
  private selected: string | null = null;
  private res = storage.get<string>('osd.res', '');

  constructor(ctx: Ctx) {
    super(ctx, 'OSD', 'On-screen display settings and a drag-and-drop screen layout.', 'osd');
  }

  private screens(): number[] {
    return [1, 2, 3, 4].filter((n) => this.ctx.has(`OSD${n}_ALTITUDE_EN`) || this.ctx.has(`OSD${n}_ENABLE`));
  }

  private items(n: number): Item[] {
    const re = new RegExp(`^OSD${n}_(.+)_EN$`);
    return [...this.ctx.vehicle.params.params.keys()]
      .map((p) => p.match(re)?.[1])
      .filter((k): k is string => !!k && this.ctx.has(`OSD${n}_${k}_X`))
      .sort()
      .map((key) => ({ key, en: `OSD${n}_${key}_EN`, x: `OSD${n}_${key}_X`, y: `OSD${n}_${key}_Y` }));
  }

  protected build(): (Node | null | false)[] {
    const c = this.ctx;
    if (!c.has('OSD_TYPE')) {
      return [h('div', { class: 'page-empty' }, icon('info', 26), h('h3', null, 'This firmware has no OSD support'), h('p', null, 'Boards without an OSD chip can still use MSP DisplayPort with a build that includes it.'))];
    }
    const screens = this.screens();
    const settings = fieldsCard(c, 'Settings', 'osd', 'Choose the OSD type first and reboot — the screen layout parameters appear after that.', [
      'OSD_TYPE', 'OSD_TYPE2', 'OSD_CHAN', 'OSD_SW_METHOD', 'OSD_UNITS', 'OSD_FONT', 'OSD_MSG_TIME', 'OSD_OPTIONS', 'OSD_ARM_SCR', 'OSD_DSARM_SCR', 'OSD_FS_SCR',
    ]);
    const warn = fieldsCard(c, 'Warning thresholds', 'warn', null, ['OSD_W_RSSI', 'OSD_W_NSAT', 'OSD_W_BATVOLT', 'OSD_W_AVGCELLV', 'OSD_W_RESTVOLT', 'OSD_W_ACRVOLT', 'OSD_W_TERR', 'OSD_CELL_COUNT']);
    if (!screens.length) {
      return [grid(settings, warn), h('div', { class: 'page-empty' }, icon('osd', 26), h('h3', null, 'Screen layout appears after enabling the OSD'), h('p', null, 'Set OSD type, write, and reboot the flight controller.'))];
    }
    if (!screens.includes(this.screen)) this.screen = screens[0];
    if (!this.res) this.res = (c.param('OSD_TYPE')?.value ?? 0) === 5 ? 'hd' : 'pal';
    return [this.builder(screens), grid(settings, warn)];
  }

  // ---------- builder ----------

  private builder(screens: number[]): HTMLElement {
    const c = this.ctx;
    const n = this.screen;
    const items = this.items(n);
    const res = RES[this.res] ?? RES.pal;

    const tabs = h('div', { class: 'segmented segmented-sm', role: 'tablist' }, screens.map((s) =>
      h('button', { type: 'button', class: 'seg', role: 'tab', 'aria-selected': String(s === n), onclick: () => { this.screen = s; this.selected = null; this.rebuild(); } }, `Screen ${s}`)));
    const resSel = h('select', { 'aria-label': 'Preview resolution', onchange: () => { this.res = resSel.value; storage.set('osd.res', this.res); this.rebuild(); } },
      Object.entries(RES).map(([k, r]) => h('option', { value: k, selected: k === this.res }, r.label)));

    const canvas = h('div', { class: 'osd-canvas', style: `--cols:${res.cols};--rows:${res.rows}` });
    const els = new Map<string, HTMLElement>();
    for (const it of items) {
      const text = SAMPLE[it.key] ?? it.key.replace(/_/g, ' ').toLowerCase();
      const el = h('div', { class: 'osd-el', tabindex: 0, role: 'button', 'aria-label': `${it.key}, drag to move`, dataset: { key: it.key }, style: `--w:${text.length}` }, text);
      this.makeDraggable(el, it, res, text.length);
      el.addEventListener('pointerdown', () => this.select(it.key, els, side, items));
      el.addEventListener('focus', () => this.select(it.key, els, side, items));
      el.addEventListener('keydown', (e) => this.nudge(e, it, res, text.length));
      canvas.append(el);
      els.set(it.key, el);
    }

    const side = h('div', { class: 'osd-side' });
    const filter = h('input', { type: 'search', class: 'picker-search', placeholder: 'Filter elements', 'aria-label': 'Filter OSD elements' });
    const list = h('div', { class: 'osd-items' });
    const renderList = () => {
      const q = filter.value.trim().toLowerCase();
      clear(list, items.filter((it) => !q || it.key.toLowerCase().includes(q) || (c.m(it.en)?.n ?? '').toLowerCase().includes(q)).map((it) => {
        const cb = h('input', { type: 'checkbox', checked: (c.value(it.en) ?? 0) !== 0, onchange: () => { c.stage(it.en, cb.checked ? 1 : 0); this.select(it.key, els, side, items); } });
        return h('label', { class: `osd-item${c.staging.isPending(it.en) ? ' is-pending' : ''}${this.selected === it.key ? ' is-selected' : ''}` },
          cb, h('span', null, prettyKey(it.key)), h('span', { class: 'osd-item-code' }, it.key));
      }));
    };
    filter.addEventListener('input', renderList);

    c.watch(() => {
      for (const it of items) {
        const el = els.get(it.key)!;
        const on = (c.value(it.en) ?? 0) !== 0;
        el.hidden = !on;
        el.style.setProperty('--x', String(c.value(it.x) ?? 0));
        el.style.setProperty('--y', String(c.value(it.y) ?? 0));
        el.classList.toggle('is-pending', c.staging.isPending(it.x) || c.staging.isPending(it.y) || c.staging.isPending(it.en));
      }
      if (document.activeElement !== filter) renderList();
    });

    const screenFields = h('div', { class: 'fields fields-inline' }, field(c, `OSD${n}_ENABLE`, { label: 'Screen enabled', help: false }), field(c, `OSD${n}_CHAN_MIN`, { help: false }), field(c, `OSD${n}_CHAN_MAX`, { help: false }));
    this.renderSide(side, items);

    return card('Screen layout', 'osd', 'Drag elements to place them; arrow keys nudge the selected one. Element widths are approximate.',
      h('div', { class: 'osd-toolbar' }, tabs, resSel),
      screenFields,
      h('div', { class: 'osd-layout' },
        h('div', { class: 'osd-stage' }, canvas),
        h('div', { class: 'osd-panel' }, side, filter, list)));
  }

  private select(key: string, els: Map<string, HTMLElement>, side: HTMLElement, items: Item[]) {
    this.selected = key;
    for (const [k, el] of els) el.classList.toggle('is-selected', k === key);
    this.renderSide(side, items);
    this.ctx.refresh();
  }

  private renderSide(side: HTMLElement, items: Item[]) {
    const it = items.find((i) => i.key === this.selected);
    if (!it) { clear(side, h('p', { class: 'osd-hint' }, 'Select an element on the screen or tick it in the list.')); return; }
    clear(side, h('div', { class: 'osd-selected' },
      h('strong', null, prettyKey(it.key)),
      h('div', { class: 'fields fields-inline' }, field(this.ctx, it.en, { label: 'Shown', help: false, kind: 'switch' }), field(this.ctx, it.x, { label: 'X', help: false }), field(this.ctx, it.y, { label: 'Y', help: false }))));
  }

  private makeDraggable(el: HTMLElement, it: Item, res: { cols: number; rows: number }, width: number) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const canvas = el.parentElement!;
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width / res.cols, ch = rect.height / res.rows;
      const startX = this.ctx.value(it.x) ?? 0, startY = this.ctx.value(it.y) ?? 0;
      const grabX = Math.floor((e.clientX - rect.left) / cw) - startX;
      const grabY = Math.floor((e.clientY - rect.top) / ch) - startY;
      let nx = startX, ny = startY;
      el.classList.add('is-dragging');
      const move = (ev: PointerEvent) => {
        nx = Math.max(0, Math.min(res.cols - Math.min(width, res.cols), Math.floor((ev.clientX - rect.left) / cw) - grabX));
        ny = Math.max(0, Math.min(res.rows - 1, Math.floor((ev.clientY - rect.top) / ch) - grabY));
        el.style.setProperty('--x', String(nx));
        el.style.setProperty('--y', String(ny));
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.classList.remove('is-dragging');
        if (nx !== startX || ny !== startY) this.ctx.staging.stageMany([[it.x, nx], [it.y, ny]]);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
      el.addEventListener('pointercancel', up, { once: true });
    });
  }

  private nudge(e: KeyboardEvent, it: Item, res: { cols: number; rows: number }, width: number) {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    const x = Math.max(0, Math.min(res.cols - Math.min(width, res.cols), (this.ctx.value(it.x) ?? 0) + step[0]));
    const y = Math.max(0, Math.min(res.rows - 1, (this.ctx.value(it.y) ?? 0) + step[1]));
    this.ctx.staging.stageMany([[it.x, x], [it.y, y]]);
  }
}

const PRETTY: Record<string, string> = {
  BAT_VOLT: 'Battery voltage', BATUSED: 'Battery used', FLTMODE: 'Flight mode', GSPEED: 'Ground speed', ASPEED: 'Airspeed',
  VSPEED: 'Vertical speed', HOMEDIST: 'Home distance', HOMEDIR: 'Home direction', CRSSHAIR: 'Crosshair', FLTIME: 'Flight time',
  CLK: 'Clock', HDOP: 'GPS HDOP', SATS: 'Satellites', RSSI: 'RSSI', LINK_Q: 'Link quality', VTX_PWR: 'VTX power', TER_HGT: 'Terrain height',
  ESCTEMP: 'ESC temperature', ESCRPM: 'ESC RPM', ESCAMPS: 'ESC current', AVGCELLV: 'Average cell voltage', CELLVOLT: 'Cell voltage',
  RESTVOLT: 'Resting voltage', ACRVOLT: 'Avg resting cell voltage', BATTBAR: 'Battery bar', GPSLAT: 'Latitude', GPSLONG: 'Longitude',
  XTRACK: 'Cross-track error', CLIMBEFF: 'Climb efficiency', EFF: 'Efficiency', BTEMP: 'Baro temperature', ATEMP: 'Airspeed temperature',
  BAT2_VLT: 'Battery 2 voltage', BAT2USED: 'Battery 2 used', ASPD1: 'Airspeed 1', ASPD2: 'Airspeed 2', CURRENT2: 'Current 2',
  RNGF: 'Rangefinder', PLUSCODE: 'Plus code', CALLSIGN: 'Callsign', SIDEBARS: 'Sidebars', WAYPOINT: 'Waypoint', DIST: 'Distance travelled',
};
const prettyKey = (k: string) => PRETTY[k] ?? k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ');
