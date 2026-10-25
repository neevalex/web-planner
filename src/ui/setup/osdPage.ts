// OSD: settings and a drag-and-drop screen builder for OSDn_<ITEM>_EN/_X/_Y.
import { clear, h, storage } from '../dom';
import { icon } from '../icons';
import { card, field, fieldsCard, grid, Page, type Ctx } from './kit';
import { OSD_FONTS, type OsdFont } from './osdSymbols';
import { bounds, drawGlyph, loadFont, renderElement, type Cell, type Glyphs, type RenderOpts } from './osdRender';

const SD_GRID: Record<string, { cols: number; rows: number; label: string }> = {
  pal: { cols: 30, rows: 16, label: 'PAL 30×16' },
  ntsc: { cols: 30, rows: 13, label: 'NTSC 30×13' },
};
const HD_GRID = { cols: 50, rows: 18 };
/** OSDn_TXT_RES: per-screen text grid on MSP DisplayPort. */
const TXT_RES = [{ cols: 30, rows: 16 }, { cols: 50, rows: 18 }, { cols: 60, rows: 22 }, { cols: 53, rows: 20 }];
/** Elements only MSP OSD goggles (OSD_TYPE 3) draw themselves; ArduPilot's own OSD backends skip them. */
const MSP_ONLY = new Set(['CRSSHAIR', 'HOMEDIST', 'HOMEDIR', 'POWER', 'CELLVOLT', 'BATTBAR', 'ARMING']);

const FONT_GROUPS: [string, (f: OsdFont) => boolean][] = [
  ['ArduPilot analog (MAX7456)', (f) => f.kind === 'sd' && f.symbols === 'ap'],
  ['Betaflight analog', (f) => f.kind === 'sd' && f.symbols === 'bf'],
  ['Walksnail Avatar HD', (f) => f.family === 'walksnail'],
  ['DJI goggles (WTFOS)', (f) => f.family === 'dji'],
];

interface Item { key: string; en: string; x: string; y: string }

export class OsdPage extends Page {
  private screen = 1;
  private selected: string | null = null;
  private sdGrid = storage.get<string>('osd.res', 'pal');
  private fontId = storage.get<string>('osd.font', '');
  private glyphs: Glyphs | null = null;

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
    return [this.builder(screens), grid(settings, warn)];
  }

  // ---------- builder ----------

  /** The font the vehicle is set up for: HD DisplayPort → ArduPilot HD font (or Betaflight's when BTFL symbols are on), else OSD_FONT. */
  private defaultFont(): OsdFont {
    const c = this.ctx;
    const type = c.value('OSD_TYPE') ?? 0;
    if (type === 5) {
      const btfl = ((c.value('MSP_OPTIONS') ?? 0) & 4) !== 0;
      return OSD_FONTS.find((f) => f.id === (btfl ? 'bf-default' : 'ws-ardu'))!;
    }
    const sd = OSD_FONTS.filter((f) => f.kind === 'sd' && f.symbols === 'ap');
    return sd[Math.max(0, Math.min(sd.length - 1, c.value('OSD_FONT') ?? 0))];
  }

  private font(): OsdFont {
    return OSD_FONTS.find((f) => f.id === this.fontId) ?? this.defaultFont();
  }

  private builder(screens: number[]): HTMLElement {
    const c = this.ctx;
    const n = this.screen;
    const items = this.items(n);
    const font = this.font();
    const hd = font.kind === 'hd';
    const type = c.value('OSD_TYPE') ?? 0;
    const txtRes = type === 5 && c.has(`OSD${n}_TXT_RES`) ? TXT_RES[c.value(`OSD${n}_TXT_RES`) ?? 0] : undefined;
    const res = txtRes ?? (hd ? HD_GRID : SD_GRID[this.sdGrid] ?? SD_GRID.pal);
    const mspOnlyHidden = (key: string) => type !== 3 && MSP_ONLY.has(key);

    const tabs = h('div', { class: 'segmented segmented-sm', role: 'tablist' }, screens.map((s) =>
      h('button', { type: 'button', class: 'seg', role: 'tab', 'aria-selected': String(s === n), onclick: () => { this.screen = s; this.selected = null; this.rebuild(); } }, `Screen ${s}`)));

    const def = this.defaultFont();
    const fontSel = h('select', { 'aria-label': 'Preview font', onchange: () => {
      this.fontId = fontSel.value === def.id ? '' : fontSel.value;
      storage.set('osd.font', this.fontId);
      this.glyphs = null;
      this.rebuild();
    } }, FONT_GROUPS.map(([label, test]) => h('optgroup', { label }, OSD_FONTS.filter(test).map((f) =>
      h('option', { value: f.id, selected: f.id === font.id }, `${f.label}${f.id === def.id ? ' — vehicle setting' : ''}`)))));
    const sdSel: HTMLSelectElement = h('select', { 'aria-label': 'Video standard', onchange: () => { this.sdGrid = sdSel.value; storage.set('osd.res', this.sdGrid); this.rebuild(); } },
      Object.entries(SD_GRID).map(([k, r]) => h('option', { value: k, selected: k === this.sdGrid }, r.label)));
    const gridSel = txtRes ? h('span', { class: 'osd-gridlabel', title: `Set by OSD${n}_TXT_RES` }, `DisplayPort ${res.cols}×${res.rows}`)
      : hd ? h('span', { class: 'osd-gridlabel' }, `HD ${res.cols}×${res.rows}`) : sdSel;

    // Glyph canvas at the font's native pixel size, scaled to fit; hit boxes sit on top for selecting and dragging.
    const canvas = h('canvas', { class: 'osd-glyphs', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    const stage = h('div', { class: `osd-canvas${hd ? ' is-hd' : ''}`, style: `--cols:${res.cols};--rows:${res.rows}` }, canvas);
    const status = h('p', { class: 'osd-hint osd-fontstatus' });

    const drag = new Map<string, [number, number]>();
    const cellsOf = new Map<string, Cell[]>();
    const boxes = new Map<string, HTMLElement>();
    const side = h('div', { class: 'osd-side' });

    const opts = (): RenderOpts => ({
      symbols: font.symbols, units: c.value('OSD_UNITS') ?? 0, options: c.value('OSD_OPTIONS') ?? 0, sd: !hd,
      cellCount: c.value('OSD_CELL_COUNT') ?? 0, sidebarHOfs: c.value('OSD_SB_H_OFS') ?? 0, sidebarVExt: c.value('OSD_SB_V_EXT') ?? 0,
    });
    const pos = (it: Item): [number, number] => drag.get(it.key) ?? [c.value(it.x) ?? 0, c.value(it.y) ?? 0];

    const draw = () => {
      const g = this.glyphs;
      const o = opts();
      for (const it of items) cellsOf.set(it.key, renderElement(it.key, o));
      if (g) {
        if (canvas.width !== res.cols * g.gw || canvas.height !== res.rows * g.gh) { canvas.width = res.cols * g.gw; canvas.height = res.rows * g.gh; }
        const ctx2 = canvas.getContext('2d')!;
        ctx2.imageSmoothingEnabled = false;
        ctx2.clearRect(0, 0, canvas.width, canvas.height);
        for (const it of items) {
          if ((c.value(it.en) ?? 0) === 0 || mspOnlyHidden(it.key)) continue;
          const [x, y] = pos(it);
          for (const cell of cellsOf.get(it.key)!) {
            const cx = x + cell.dx, cy = y + cell.dy;
            if (cx >= 0 && cy >= 0 && cx < res.cols && cy < res.rows) drawGlyph(ctx2, g, cell.code, cx * g.gw, cy * g.gh);
          }
        }
      }
      for (const it of items) {
        const box = boxes.get(it.key)!;
        const on = (c.value(it.en) ?? 0) !== 0;
        const b = bounds(cellsOf.get(it.key)!);
        const [x, y] = pos(it);
        box.hidden = !on;
        box.style.setProperty('--x', String(x + b.x0));
        box.style.setProperty('--y', String(y + b.y0));
        box.style.setProperty('--w', String(b.x1 - b.x0));
        box.style.setProperty('--h', String(b.y1 - b.y0));
        box.classList.toggle('is-pending', c.staging.isPending(it.x) || c.staging.isPending(it.y) || c.staging.isPending(it.en));
      }
    };

    for (const it of items) {
      const msp = mspOnlyHidden(it.key);
      const box = h('div', { class: `osd-el${msp ? ' is-msp' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${prettyKey(it.key)}, drag to move`, dataset: { key: it.key },
        title: msp ? `${prettyKey(it.key)} — only drawn by MSP OSD goggles (OSD type 3)` : prettyKey(it.key) });
      if (it.key === this.selected) box.classList.add('is-selected');
      this.makeDraggable(box, it, res, cellsOf, drag, draw);
      box.addEventListener('pointerdown', () => this.select(it.key, boxes, side, items));
      box.addEventListener('focus', () => this.select(it.key, boxes, side, items));
      box.addEventListener('keydown', (e) => this.nudge(e, it, res, cellsOf));
      stage.append(box);
      boxes.set(it.key, box);
    }

    if (this.glyphs?.font.id !== font.id) {
      this.glyphs = null;
      status.textContent = 'Loading font…';
      loadFont(font).then((g) => { if (this.font().id === g.font.id) { this.glyphs = g; status.textContent = ''; draw(); } })
        .catch((e: Error) => { status.textContent = e.message; });
    }

    const filter = h('input', { type: 'search', class: 'picker-search', placeholder: 'Filter elements', 'aria-label': 'Filter OSD elements' });
    const list = h('div', { class: 'osd-items' });
    const renderList = () => {
      const q = filter.value.trim().toLowerCase();
      clear(list, items.filter((it) => !q || it.key.toLowerCase().includes(q) || (c.m(it.en)?.n ?? '').toLowerCase().includes(q)).map((it) => {
        const cb = h('input', { type: 'checkbox', checked: (c.value(it.en) ?? 0) !== 0, onchange: () => { c.stage(it.en, cb.checked ? 1 : 0); this.select(it.key, boxes, side, items); } });
        return h('label', { class: `osd-item${c.staging.isPending(it.en) ? ' is-pending' : ''}${this.selected === it.key ? ' is-selected' : ''}` },
          cb, h('span', null, prettyKey(it.key), mspOnlyHidden(it.key) ? h('span', { class: 'osd-item-tag', title: 'Only drawn by MSP OSD goggles (OSD type 3)' }, 'MSP') : null), h('span', { class: 'osd-item-code' }, it.key));
      }));
    };
    filter.addEventListener('input', renderList);

    const resKey = `${type}/${txtRes ? c.value(`OSD${n}_TXT_RES`) : '-'}`;
    c.watch(() => {
      const t = c.value('OSD_TYPE') ?? 0;
      if (`${t}/${t === 5 && c.has(`OSD${n}_TXT_RES`) ? c.value(`OSD${n}_TXT_RES`) : '-'}` !== resKey) { queueMicrotask(() => this.rebuild()); return; }
      draw();
      if (document.activeElement !== filter) renderList();
    });

    const screenFields = h('div', { class: 'fields fields-inline' }, field(c, `OSD${n}_ENABLE`, { label: 'Screen enabled', help: false }), field(c, `OSD${n}_CHAN_MIN`, { help: false }), field(c, `OSD${n}_CHAN_MAX`, { help: false }),
      field(c, `OSD${n}_TXT_RES`, { label: 'Text grid', help: false }), field(c, `OSD${n}_FONT`, { label: 'Font index', help: false }));
    this.renderSide(side, items);

    return card('Screen layout', 'osd', 'Drag elements to place them; arrow keys nudge the selected one. The preview draws each element with the real OSD font glyphs and sample values.',
      h('div', { class: 'osd-toolbar' }, tabs, h('div', { class: 'osd-toolbar-right' }, fontSel, gridSel)),
      screenFields,
      h('div', { class: 'osd-layout' },
        h('div', { class: 'osd-stage' }, stage, status),
        h('div', { class: 'osd-panel' }, side, filter, list)));
  }

  private select(key: string, els: Map<string, HTMLElement>, side: HTMLElement, items: Item[]) {
    if (this.selected === key) return;
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

  /** Anchor positions that keep the element's glyphs on screen. */
  private clampPos(it: Item, x: number, y: number, res: { cols: number; rows: number }, cellsOf: Map<string, Cell[]>): [number, number] {
    const b = bounds(cellsOf.get(it.key) ?? []);
    const maxX = Math.max(-b.x0, res.cols - b.x1), maxY = Math.max(-b.y0, res.rows - b.y1);
    return [Math.max(-b.x0, Math.min(maxX, x)), Math.max(-b.y0, Math.min(maxY, y))];
  }

  private makeDraggable(el: HTMLElement, it: Item, res: { cols: number; rows: number }, cellsOf: Map<string, Cell[]>, drag: Map<string, [number, number]>, draw: () => void) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const rect = el.parentElement!.getBoundingClientRect();
      const cw = rect.width / res.cols, ch = rect.height / res.rows;
      const startX = this.ctx.value(it.x) ?? 0, startY = this.ctx.value(it.y) ?? 0;
      const grabX = Math.floor((e.clientX - rect.left) / cw) - startX;
      const grabY = Math.floor((e.clientY - rect.top) / ch) - startY;
      let nx = startX, ny = startY;
      el.classList.add('is-dragging');
      const move = (ev: PointerEvent) => {
        [nx, ny] = this.clampPos(it, Math.floor((ev.clientX - rect.left) / cw) - grabX, Math.floor((ev.clientY - rect.top) / ch) - grabY, res, cellsOf);
        drag.set(it.key, [nx, ny]);
        draw();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.classList.remove('is-dragging');
        drag.delete(it.key);
        if (nx !== startX || ny !== startY) this.ctx.staging.stageMany([[it.x, nx], [it.y, ny]]);
        else draw();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
      el.addEventListener('pointercancel', up, { once: true });
    });
  }

  private nudge(e: KeyboardEvent, it: Item, res: { cols: number; rows: number }, cellsOf: Map<string, Cell[]>) {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    const [x, y] = this.clampPos(it, (this.ctx.value(it.x) ?? 0) + step[0], (this.ctx.value(it.y) ?? 0) + step[1], res, cellsOf);
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
