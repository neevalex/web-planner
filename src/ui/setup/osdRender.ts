// OSD preview renderer: ArduPilot's element formats (ported from AP_OSD_Screen.cpp) drawn with real
// OSD font glyphs — ArduPilot MAX7456 fonts, Betaflight fonts, and Walksnail / DJI WTFOS HD fonts.
import { AP_SYMBOLS, BF_SYMBOLS, DIG_OFS_1, DIG_OFS_2, type OsdFont, type SymbolSet } from './osdSymbols';

// ---------- fonts ----------

export interface Glyphs { img: HTMLImageElement; font: OsdFont; gw: number; gh: number }

const cache = new Map<string, Promise<Glyphs>>();

export function loadFont(font: OsdFont): Promise<Glyphs> {
  let p = cache.get(font.id);
  if (!p) {
    p = new Promise<Glyphs>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // SD atlases are 16×16 grids of 12×18; HD fonts are vertical strips of w × 1.5w glyphs.
        const gw = font.kind === 'sd' ? 12 : img.naturalWidth;
        const gh = font.kind === 'sd' ? 18 : Math.round(img.naturalWidth * 1.5);
        resolve({ img, font, gw, gh });
      };
      img.onerror = () => { cache.delete(font.id); reject(new Error(`Font ${font.label} failed to load`)); };
      img.src = `${import.meta.env.BASE_URL}osd-fonts/${font.id}.png`;
    });
    cache.set(font.id, p);
  }
  return p;
}

export function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyphs, code: number, x: number, y: number) {
  if (code === 0x20 || code < 0) return;
  const sx = g.font.kind === 'sd' ? (code % 16) * 12 : 0;
  const sy = g.font.kind === 'sd' ? Math.floor(code / 16) * 18 : code * g.gh;
  ctx.drawImage(g.img, sx, sy, g.gw, g.gh, x, y, g.gw, g.gh);
}

// ---------- printf ----------

/** Minimal C printf: %[flags][width][.prec](d|u|ld|lu|hu|f|c|s). %c takes a char code. */
export function printf(fmt: string, ...args: (number | string)[]): string {
  let ai = 0;
  return fmt.replace(/%([-0 +]*)(\d*)(?:\.(\d+))?(l|h)?([dufcs%])/g, (_m, flags: string, width: string, prec: string | undefined, _len, conv: string) => {
    if (conv === '%') return '%';
    const a = args[ai++];
    let s: string;
    if (conv === 'c') return String.fromCharCode(Number(a));
    if (conv === 's') s = String(a);
    else if (conv === 'f') s = Number(a).toFixed(prec === undefined ? 6 : Number(prec));
    else s = String(Math.trunc(Number(a)));
    if (flags.includes(' ') && conv !== 's' && Number(a) >= 0) s = ' ' + s;
    const w = Number(width || 0);
    if (s.length < w) {
      if (flags.includes('-')) s = s.padEnd(w, ' ');
      else if (flags.includes('0') && conv !== 's') s = (s.startsWith('-') ? '-' + s.slice(1).padStart(w - 1, '0') : s.padStart(w, '0'));
      else s = s.padStart(w, ' ');
    }
    return s;
  });
}

// ---------- vehicle sample shown in the preview ----------

export const SAMPLE = {
  alt: 120, volt: 16.4, battPct: 72, current: 12.34, mah: 850, sats: 14, mode: 'STAB', armed: false,
  message: 'PREARM: NEED 3D FIX', gspeed: 11.7, gspeedDir: 30, roll: 8, pitch: -4, yaw: 270,
  homeDist: 230, homeBearing: 45, throttle: 45, wind: 3.2, windDir: 200, aspeed: 13.9, vspeed: 2.1,
  escTemp: 45, escRpm: 12340, escAmps: 8.2, lat: 50.4501234, lon: 30.5234567, temp: 24, hdop: 0.8,
  wp: 3, wpBearing: 60, wpDist: 340, xtrack: 2, dist: 1234, flightSec: 332, eff: 120, btemp: 31, atemp: 22,
  bat2volt: 8.2, bat2mah: 210, clock: '14:05', callsign: 'CALLSIGN', current2: 3.1, vtxMw: 25, terHgt: 80,
  rngf: 1.2, rpm: 9500, lq: 99, rssi: 99, cells: 4, restVolt: 16.1, txMw: 250, dbm: 72, snr: 9, ant: 1,
};

export interface RenderOpts {
  symbols: 'ap' | 'bf';
  units: number;      // OSD_UNITS: 0 metric, 1 imperial, 2 SI, 3 aviation
  options: number;    // OSD_OPTIONS bitmask
  sd: boolean;        // analog (aspect ratio of MAX7456 PAL) vs HD DisplayPort
  cellCount: number;  // OSD_CELL_COUNT
  sidebarHOfs: number; sidebarVExt: number;
}

export interface Cell { dx: number; dy: number; code: number }

// unit tables from AP_OSD_AbstractScreen::u_icon / u_scale
type UnitType = 'ALTITUDE' | 'SPEED' | 'VSPEED' | 'DISTANCE' | 'DISTANCE_LONG' | 'TEMPERATURE';
const ICONS: Record<UnitType, string>[] = [
  { ALTITUDE: 'ALT_M', SPEED: 'KMH', VSPEED: 'MS', DISTANCE: 'M', DISTANCE_LONG: 'KM', TEMPERATURE: 'DEGREES_C' },
  { ALTITUDE: 'ALT_FT', SPEED: 'MPH', VSPEED: 'FS', DISTANCE: 'FT', DISTANCE_LONG: 'MI', TEMPERATURE: 'DEGREES_F' },
  { ALTITUDE: 'ALT_M', SPEED: 'MS', VSPEED: 'MS', DISTANCE: 'M', DISTANCE_LONG: 'KM', TEMPERATURE: 'DEGREES_C' },
  { ALTITUDE: 'ALT_FT', SPEED: 'KN', VSPEED: 'FTMIN', DISTANCE: 'FT', DISTANCE_LONG: 'NM', TEMPERATURE: 'DEGREES_C' },
];
const SCALE: Record<UnitType, number>[] = [
  { ALTITUDE: 1, SPEED: 3.6, VSPEED: 1, DISTANCE: 1, DISTANCE_LONG: 1 / 1000, TEMPERATURE: 1 },
  { ALTITUDE: 3.28084, SPEED: 2.23694, VSPEED: 3.28084, DISTANCE: 3.28084, DISTANCE_LONG: 1 / 1609.34, TEMPERATURE: 1.8 },
  { ALTITUDE: 1, SPEED: 1, VSPEED: 1, DISTANCE: 1, DISTANCE_LONG: 1 / 1000, TEMPERATURE: 1 },
  { ALTITUDE: 3.28084, SPEED: 1.94384, VSPEED: 196.85, DISTANCE: 3.28084, DISTANCE_LONG: 0.000539957, TEMPERATURE: 1 },
];

const OPT = { DECIMAL_PACK: 1, INVERTED_WIND: 2, INVERTED_AH_ROLL: 4, IMPERIAL_MILES: 8, DISABLE_CROSSHAIR: 16, BF_ARROWS: 32, AVIATION_AH: 64 };
const D2R = Math.PI / 180;

/** Renders one OSD element (by its parameter key, e.g. ALTITUDE) to cells relative to its X/Y anchor. */
export function renderElement(key: string, o: RenderOpts, s = SAMPLE): Cell[] {
  const SYMS: SymbolSet = o.symbols === 'bf' ? BF_SYMBOLS : AP_SYMBOLS;
  const S = (n: string) => SYMS[n] ?? AP_SYMBOLS[n] ?? 0x3f;
  const units = Math.max(0, Math.min(3, o.units));
  const uIcon = (u: UnitType) => S(ICONS[units][u]);
  const uScale = (u: UnitType, v: number) => v * SCALE[units][u] + (units === 1 && u === 'TEMPERATURE' ? 32 : 0);
  const pack = (o.options & OPT.DECIMAL_PACK) !== 0 && o.symbols === 'ap';
  const cells: Cell[] = [];

  const write = (dx: number, dy: number, text: string) => {
    let codes = [...text].map((ch) => ch.charCodeAt(0));
    if (pack) {
      // AP_OSD_Backend::convert_to_decimal_packed_characters
      const i = codes.indexOf(0x2e, 1);
      if (i > 0 && isDigit(codes[i - 1]) && isDigit(codes[i + 1])) {
        codes[i - 1] += DIG_OFS_1; codes[i + 1] += DIG_OFS_2;
        codes = [...codes.slice(0, i), ...codes.slice(i + 1)];
      }
    }
    codes.forEach((code, i) => cells.push({ dx: dx + i, dy, code: code & 0xff }));
  };
  const w = (dx: number, dy: number, fmt: string, ...a: (number | string)[]) => write(dx, dy, printf(fmt, ...a));
  const arrow = (deg: number) => {
    let cd = ((Math.round(deg * 100) % 36000) + 36000) % 36000;
    const count = S('ARROW_COUNT'), interval = 36000 / count;
    if (o.options & OPT.BF_ARROWS) cd = cd > 18000 ? 54000 - cd : 18000 - cd;
    return S('ARROW_START') + Math.floor((cd + interval / 2) / interval) % count;
  };
  const distance = (dx: number, d: number) => {
    let icon = uIcon('DISTANCE');
    let v = uScale('DISTANCE', d);
    let fmt = '%4.0f%c';
    if (v > 9999 || (units === 1 && v > 5280 && (o.options & OPT.IMPERIAL_MILES))) {
      v = uScale('DISTANCE_LONG', d); icon = uIcon('DISTANCE_LONG');
      fmt = v < 9 ? '%1.3f%c' : v < 99 ? '%2.2f%c' : v < 999 ? '%3.1f%c' : '%4.0f%c';
    } else if (v < 10) fmt = '% 3.1f%c';
    w(dx, 0, fmt, v, icon);
  };
  const speed = (dx: number, angle: number, mag: number) => {
    const v = uScale('SPEED', mag);
    if (v < 9.95) w(dx, 0, '%c %1.1f%c', arrow(angle), v, uIcon('SPEED'));
    else w(dx, 0, '%c%3d%c', arrow(angle), Math.round(v), uIcon('SPEED'));
  };
  const battIcon = S('BATT_FULL') + Math.floor((100 - s.battPct) / 16.6);
  const volt = (v: number, cell: boolean) => w(0, 0, cell ? '%c%1.2f%c' : '%c%2.1f%c', battIcon, v, S('VOLT'));
  const cellV = (v: number) => (o.cellCount > 0 ? v / o.cellCount : o.cellCount < 0 ? NaN : v / Math.floor(v * 0.2381 + 1));

  switch (key) {
    case 'ALTITUDE': w(0, 0, '%4d%c', Math.trunc(uScale('ALTITUDE', s.alt)), uIcon('ALTITUDE')); break;
    case 'BAT_VOLT': volt(s.volt, false); break;
    case 'RESTVOLT': volt(s.restVolt, false); break;
    case 'AVGCELLV': case 'ACRVOLT': {
      const v = cellV(key === 'AVGCELLV' ? s.volt : s.restVolt);
      if (Number.isNaN(v)) w(0, 0, '%c---%c', battIcon, S('VOLT')); else volt(v, true);
      break;
    }
    case 'CELLVOLT': w(0, 0, '%c%1.2f%c', battIcon, s.volt / s.cells, S('VOLT')); break;
    case 'BAT2_VLT': w(0, 0, '%c%2.1f%c', battIcon, s.bat2volt, S('VOLT')); break;
    case 'RSSI': w(0, 0, '%c%2d', S('RSSI'), s.rssi); break;
    case 'LINK_Q': w(0, 0, '%c%2d', S('LQ'), s.lq); break;
    case 'CURRENT': w(0, 0, s.current < 10 ? '%2.2f%c' : '%2.1f%c', s.current, S('AMP')); break;
    case 'CURRENT2': w(0, 0, s.current2 < 10 ? '%2.2f%c' : '%2.1f%c', s.current2, S('AMP')); break;
    case 'FLTMODE': w(0, 0, '%s%c', s.mode, s.armed ? S('ARMED') : S('DISARMED')); break;
    case 'SATS': w(0, 0, '%c%c%2u', S('SAT_L'), S('SAT_R'), s.sats); break;
    case 'BATUSED': w(0, 0, '%4d%c', s.mah, S('MAH')); break;
    case 'BAT2USED': w(0, 0, '%4d%c', s.bat2mah, S('MAH')); break;
    case 'MESSAGE': write(0, 0, s.message.toUpperCase().slice(0, 26)); break;
    case 'GSPEED': w(0, 0, '%c', S('GSPD')); speed(1, s.gspeedDir, s.gspeed); break;
    case 'WIND': w(0, 0, '%c', S('WSPD')); speed(1, s.windDir + ((o.options & OPT.INVERTED_WIND) ? 180 : 0), s.wind); break;
    case 'ASPEED': case 'ASPD1': case 'ASPD2': w(0, 0, '%c%4d%c', S('ASPD'), Math.trunc(uScale('SPEED', s.aspeed)), uIcon('SPEED')); break;
    case 'VSPEED': {
      const v = s.vspeed;
      const sym = v > 3 ? S('UP_UP') : v >= 0 ? S('UP') : v >= -3 ? S('DOWN') : S('DOWN_DOWN');
      const sc = uScale('VSPEED', Math.abs(v));
      if (units !== 3 && sc < 9.95) w(0, 0, '%c%.1f%c', sym, sc, uIcon('VSPEED'));
      else w(0, 0, units === 3 ? '%c%4d%c' : '%c%2d%c', sym, Math.round(sc), uIcon('VSPEED'));
      break;
    }
    case 'HORIZON': {
      let roll = s.roll * D2R, pitch = -s.pitch * D2R;
      if (o.options & OPT.INVERTED_AH_ROLL) roll = -roll;
      pitch = Math.max(-20 * D2R, Math.min(20 * D2R, pitch));
      const toChar = 16 / (80 * D2R);
      const ky = Math.sin(roll), kx = Math.cos(roll);
      const ratio = o.sd ? 12 / 15 : 12 / 18;
      if (Math.abs(ky) < Math.abs(kx)) {
        for (let dx = -4; dx <= 4; dx++) {
          const fy = (ratio * dx) * (ky / kx) + pitch * toChar + 0.5;
          const dy = Math.floor(fy);
          const c = Math.floor((fy - dy) * S('AH_H_COUNT'));
          if (dy >= -4 && dy <= 4) cells.push({ dx, dy: -dy, code: S('AH_H_START') + (S('AH_H_COUNT') - 1 - c) });
        }
      } else {
        for (let dy = -4; dy <= 4; dy++) {
          const fx = ((dy / ratio) - pitch * toChar) * (kx / ky) + 0.5;
          const dx = Math.floor(fx);
          const c = Math.floor((fx - dx) * S('AH_V_COUNT'));
          if (dx >= -4 && dx <= 4) cells.push({ dx, dy: -dy, code: S('AH_V_START') + c });
        }
      }
      if (!(o.options & OPT.DISABLE_CROSSHAIR)) w(-1, 0, '%c%c%c', S('AH_CENTER_LINE_LEFT'), S('AH_CENTER'), S('AH_CENTER_LINE_RIGHT'));
      break;
    }
    case 'CRSSHAIR': w(-1, 0, '%c%c%c', S('AH_CENTER_LINE_LEFT'), S('AH_CENTER'), S('AH_CENTER_LINE_RIGHT')); break;
    case 'HOME': w(0, 0, '%c%c', S('HOME'), arrow(s.homeBearing - s.yaw)); distance(2, s.homeDist); break;
    case 'HOMEDIST': w(0, 0, '%c', S('HOME')); distance(1, s.homeDist); break;
    case 'HOMEDIR': w(0, 0, '%c', arrow(s.homeBearing - s.yaw)); break;
    case 'HEADING': w(0, 0, '%3d%c', s.yaw, S('DEGR')); break;
    case 'RPM': w(0, 0, '%4d%c', s.rpm, S('RPM')); break;
    case 'THROTTLE': w(0, 0, '%3d%c', s.throttle, S('PCNT')); break;
    case 'COMPASS': {
      const ring = ['HEADING_N', 'HEADING_LINE', 'HEADING_DIVIDED_LINE', 'HEADING_LINE', 'HEADING_E', 'HEADING_LINE', 'HEADING_DIVIDED_LINE', 'HEADING_LINE',
        'HEADING_S', 'HEADING_LINE', 'HEADING_DIVIDED_LINE', 'HEADING_LINE', 'HEADING_W', 'HEADING_LINE', 'HEADING_DIVIDED_LINE', 'HEADING_LINE'];
      const center = Math.floor((s.yaw * 100 + 1125) / 2250) % 16;
      for (let i = -4; i <= 4; i++) cells.push({ dx: i, dy: 0, code: S(ring[(center + i + 16) % 16]) });
      break;
    }
    case 'ESCTEMP': w(0, 0, '%3d%c', Math.trunc(uScale('TEMPERATURE', s.escTemp)), uIcon('TEMPERATURE')); break;
    case 'ESCRPM': {
      const k = s.escRpm / 1000;
      w(0, 0, k < 9.995 ? '%.2f%c%c' : k < 99.95 ? '%.1f%c%c' : '%.0f%c%c', k, S('KILO'), S('RPM'));
      break;
    }
    case 'ESCAMPS': w(0, 0, '%4.1f%c', s.escAmps, S('AMP')); break;
    case 'GPSLAT': case 'GPSLONG': {
      const v = key === 'GPSLAT' ? s.lat : s.lon;
      const dec = Math.trunc(v), frac = Math.round(Math.abs(v - dec) * 1e7);
      w(0, 0, '%c%4ld.%07ld', key === 'GPSLAT' ? S('GPS_LAT') : S('GPS_LONG'), dec, frac);
      break;
    }
    case 'ROLL': w(0, 0, '%c%3d%c', Math.abs(s.roll) < 1 ? S('ROLL0') : s.roll > 0 ? S('ROLLR') : S('ROLLL'), Math.trunc(Math.abs(s.roll)), S('DEGR')); break;
    case 'PITCH': w(0, 0, '%c%3d%c', Math.abs(s.pitch) < 1 ? S('PTCH0') : s.pitch > 0 ? S('PTCHUP') : S('PTCHDWN'), Math.trunc(Math.abs(s.pitch)), S('DEGR')); break;
    case 'TEMP': w(0, 0, '%3d%c', Math.trunc(uScale('TEMPERATURE', s.temp)), uIcon('TEMPERATURE')); break;
    case 'BTEMP': w(0, 0, '%3d%c', Math.trunc(uScale('TEMPERATURE', s.btemp)), uIcon('TEMPERATURE')); break;
    case 'ATEMP': w(0, 0, '%3d%c', Math.trunc(uScale('TEMPERATURE', s.atemp)), uIcon('TEMPERATURE')); break;
    case 'HDOP': w(0, 0, '%c%c%3.2f', S('HDOP_L'), S('HDOP_R'), s.hdop); break;
    case 'WAYPOINT': w(0, 0, '%c%2u%c', S('WPNO'), s.wp, arrow(s.wpBearing - s.yaw)); distance(4, s.wpDist); break;
    case 'XTRACK': w(0, 0, '%c', S('XERR')); distance(1, s.xtrack); break;
    case 'DIST': w(0, 0, '%c', S('DIST')); distance(1, s.dist); break;
    case 'FLTIME': w(0, 0, '%c%3u:%02u', S('FLY'), Math.floor(s.flightSec / 60), s.flightSec % 60); break;
    case 'EFF': w(0, 0, '%c%3d%c', S('EFF'), s.eff, S('MAH')); break;
    case 'CLIMBEFF': w(0, 0, '%c%c%3.1f%c', S('PTCHUP'), S('EFF'), 2.4, units === 0 || units === 2 ? S('M') : S('FT')); break;
    case 'CLK': w(0, 0, '%c%s', S('CLK'), s.clock); break;
    case 'PLUSCODE': write(0, 0, '9G4X+22'); break;
    case 'CALLSIGN': write(0, 0, s.callsign); break;
    case 'VTX_PWR': w(0, 0, '%4hu%c', s.vtxMw, S('MW')); break;
    case 'RC_PWR': w(0, 0, '%3d%c', s.txMw, S('MW')); break;
    case 'RSSIDBM': w(0, 0, '%c', S('RSSI')); w(1, 0, '%4d%c', -s.dbm, S('DBM')); break;
    case 'RC_SNR': w(0, 0, '%c%3d%c', S('SNR'), s.snr, S('DB')); break;
    case 'RC_ANT': w(0, 0, '%c%d', S('ANT'), s.ant); break;
    case 'RC_LQ': w(0, 0, '%c%2d', S('LQ'), s.lq); break;
    case 'TER_HGT': w(0, 0, '%4d%c%c', Math.trunc(uScale('ALTITUDE', s.terHgt)), uIcon('ALTITUDE'), S('TERALT')); break;
    case 'FENCE': w(0, 0, '%c', S('FENCE_ENABLED')); break;
    case 'RNGF': w(0, 0, '%c%4.1f%c', S('RNGFD'), uScale('DISTANCE', s.rngf), uIcon('DISTANCE')); break;
    case 'POWER': w(0, 0, '%3d%c', Math.round(s.volt * s.current), S('WATT')); break;
    case 'BATTBAR': {
      // DJI-only element: battery bar out of the battery level glyphs.
      for (let i = 0; i < 6; i++) cells.push({ dx: i, dy: 0, code: S('BATT_FULL') + (i < Math.round(s.battPct / 100 * 6) ? 0 : 6) });
      break;
    }
    case 'ARMING': w(0, 0, '%c', s.armed ? S('ARMED') : S('DISARMED')); break;
    case 'STATS': {
      w(2, 0, '%c%c%c', 0x4d, 0x41, 0x58);
      w(0, 1, '%c', S('GSPD')); w(1, 1, '%4d%c', Math.trunc(uScale('SPEED', 22)), uIcon('SPEED'));
      w(0, 2, '%5.1f%c', 38.2, S('AMP'));
      w(0, 3, '%5d%c', Math.trunc(uScale('ALTITUDE', 152)), uIcon('ALTITUDE'));
      w(0, 4, '%c', S('HOME')); const save = cells.length; distance(1, 640); for (let i = save; i < cells.length; i++) cells[i].dy = 4;
      w(0, 5, '%c', S('DIST')); const save2 = cells.length; distance(1, 4321); for (let i = save2; i < cells.length; i++) cells[i].dy = 5;
      break;
    }
    case 'SIDEBARS': {
      const sectors = ['SIDEBAR_A', 'SIDEBAR_B', 'SIDEBAR_C', 'SIDEBAR_D', 'SIDEBAR_E', 'SIDEBAR_F', 'SIDEBAR_G', 'SIDEBAR_E', 'SIDEBAR_F', 'SIDEBAR_G',
        'SIDEBAR_E', 'SIDEBAR_F', 'SIDEBAR_G', 'SIDEBAR_E', 'SIDEBAR_F', 'SIDEBAR_H', 'SIDEBAR_I', 'SIDEBAR_J'];
      const aspd = uScale('SPEED', s.aspeed), alt = uScale('ALTITUDE', s.alt);
      const altInt = units === 1 || units === 3 ? 20 : 10;
      const h = 7 + o.sidebarVExt * 2, mid = Math.floor(h / 2);
      let ai = Math.floor(((aspd % 10) / 10) * 18), li = Math.floor((((alt % altInt) + altInt) % altInt) / altInt * 18);
      for (let i = 0; i < h; i++) {
        if (i === mid) w(0, i, '%3d%c%c', Math.trunc(aspd), uIcon('SPEED'), S('SIDEBAR_R_ARROW'));
        else cells.push({ dx: 4, dy: i, code: S(sectors[ai]) });
        ai = (ai + 12) % 18;
      }
      for (let i = 0; i < h; i++) {
        if (i === mid) w(16 + o.sidebarHOfs, i, '%c%d%c', S('SIDEBAR_L_ARROW'), Math.trunc(alt), uIcon('ALTITUDE'));
        else cells.push({ dx: 16 + o.sidebarHOfs, dy: i, code: S(sectors[li]) });
        li = (li + 12) % 18;
      }
      break;
    }
    default: write(0, 0, key.slice(0, 8));
  }
  return cells;
}

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

export function bounds(cells: Cell[]) {
  if (!cells.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) { x0 = Math.min(x0, c.dx); y0 = Math.min(y0, c.dy); x1 = Math.max(x1, c.dx + 1); y1 = Math.max(y1, c.dy + 1); }
  return { x0, y0, x1, y1 };
}
