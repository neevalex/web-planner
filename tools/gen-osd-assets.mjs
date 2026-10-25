#!/usr/bin/env node
// Builds OSD preview assets from ArduPilot and Betaflight sources:
//   - MAX7456 .mcm fonts -> 16×16 glyph-atlas PNGs (12×18 px glyphs)
//   - ArduPilot HD fonts (Walksnail / DJI WTFOS) -> copied as-is (vertical glyph strips)
//   - ArduPilot OSD symbol tables (own font and Betaflight-compatible) -> src/ui/setup/osdSymbols.ts
//
// Usage: node tools/gen-osd-assets.mjs <ardupilot>/libraries/AP_OSD <betaflight-configurator>/resources/osd/2
// Fonts are GPL-3.0 (ArduPilot, Betaflight Configurator); see public/osd-fonts/LICENSE.txt.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const [apDir, bfDir] = process.argv.slice(2);
if (!apDir || !bfDir) { console.error('usage: gen-osd-assets.mjs <AP_OSD dir> <betaflight osd/2 dir>'); process.exit(1); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/osd-fonts');
mkdirSync(outDir, { recursive: true });

// ---------- PNG writer (RGBA, no filtering) ----------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- MCM -> atlas ----------
// MAX7456: 256 glyphs × 64 lines; first 54 lines = 18 rows × 3 bytes, 2 bits/pixel: 00 black, 10 white, x1 transparent.
function mcmToAtlas(file, name) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== 'MAX7456') throw new Error(`${file}: not an MCM file`);
  const W = 16 * 12, H = 16 * 18;
  const rgba = Buffer.alloc(W * H * 4);
  for (let g = 0; g < 256; g++) {
    const gx = (g % 16) * 12, gy = Math.floor(g / 16) * 18;
    for (let row = 0; row < 18; row++) {
      for (let b = 0; b < 3; b++) {
        const bits = lines[1 + g * 64 + row * 3 + b] ?? '01010101';
        for (let p = 0; p < 4; p++) {
          const v = bits.slice(p * 2, p * 2 + 2);
          const i = ((gy + row) * W + gx + b * 4 + p) * 4;
          if (v === '00') { rgba[i + 3] = 255; }
          else if (v === '10') { rgba[i] = rgba[i + 1] = rgba[i + 2] = 255; rgba[i + 3] = 255; }
        }
      }
    }
  }
  writeFileSync(join(outDir, `${name}.png`), png(W, H, rgba));
  return name;
}

const fonts = [];
for (const [file, id, label] of [
  ['clarity.mcm', 'ap-clarity', 'ArduPilot Clarity (OSD_FONT 0)'],
  ['clarity_medium.mcm', 'ap-clarity-medium', 'ArduPilot Clarity Medium (OSD_FONT 1)'],
  ['bfstyle.mcm', 'ap-bfstyle', 'ArduPilot BF style (OSD_FONT 2)'],
  ['bold.mcm', 'ap-bold', 'ArduPilot Bold (OSD_FONT 3)'],
  ['digital.mcm', 'ap-digital', 'ArduPilot Digital (OSD_FONT 4)'],
]) fonts.push({ id: mcmToAtlas(join(apDir, 'fonts', file), id), label, kind: 'sd', symbols: 'ap' });
for (const [file, id, label] of [['default.mcm', 'bf-default', 'Betaflight Default'], ['bold.mcm', 'bf-bold', 'Betaflight Bold']]) {
  fonts.push({ id: mcmToAtlas(join(bfDir, file), id), label, kind: 'sd', symbols: 'bf' });
}
for (const [file, id, label, family] of [
  ['HDFonts/WalkSnail/userfont/user_ardu_36.png', 'ws-ardu', 'Walksnail — ArduPilot (stock)', 'walksnail'],
  ['HDFonts/WalkSnail/userfont/WS_ARDU_Night_36.png', 'ws-night', 'Walksnail — ArduPilot Night', 'walksnail'],
  ['HDFonts/WalkSnail/userfont/WS_APC_Nexus_36.png', 'ws-nexus', 'Walksnail — Nexus', 'walksnail'],
  ['HDFonts/WalkSnail/userfont/WS_APC_Conthrax_36.png', 'ws-conthrax', 'Walksnail — Conthrax', 'walksnail'],
  ['HDFonts/WTFOS-DJI/Ver0.12_or_later/WS_ardu_36.png', 'dji-ardu', 'DJI WTFOS — ArduPilot', 'dji'],
]) {
  copyFileSync(join(apDir, 'fonts', file), join(outDir, `${id}.png`));
  fonts.push({ id, label, kind: 'hd', symbols: 'ap', family });
}

writeFileSync(join(outDir, 'LICENSE.txt'), `OSD fonts in this folder come from:
- ArduPilot (libraries/AP_OSD/fonts), GPL-3.0 — https://github.com/ArduPilot/ardupilot
- Betaflight Configurator (resources/osd), GPL-3.0 — https://github.com/betaflight/betaflight-configurator
The .mcm fonts were converted to PNG glyph atlases (16×16 grid of 12×18 glyphs). HD fonts are unmodified.
`);

// ---------- symbol tables ----------
function symbolsFrom(text) {
  const out = {};
  for (const m of text.matchAll(/static (?:const|constexpr) uint8_t (SYM_\w+)\s*=\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  // resolve aliases (SYM_SIDEBAR_B = SYM_SIDEBAR_A) and hex
  const val = (k, seen = new Set()) => {
    const v = out[k];
    if (/^0x[0-9a-f]+$/i.test(v)) return parseInt(v, 16);
    if (/^\d+$/.test(v)) return Number(v);
    if (out[v] !== undefined && !seen.has(v)) { seen.add(v); return val(v, seen); }
    throw new Error(`can't resolve ${k} = ${v}`);
  };
  return Object.fromEntries(Object.keys(out).map((k) => [k.replace(/^SYM_/, ''), val(k)]));
}
const ap = symbolsFrom(readFileSync(join(apDir, 'AP_OSD_Backend.h'), 'utf8'));
const bf = symbolsFrom(readFileSync(join(apDir, 'AP_OSD_MSP_DisplayPort.h'), 'utf8'));
const digOfs = readFileSync(join(apDir, 'AP_OSD_Backend.cpp'), 'utf8').match(/SYM_DIG_OFS_1 (0x[0-9A-F]+)[\s\S]*SYM_DIG_OFS_2 (0x[0-9A-F]+)/i);

const ts = `// AUTO-GENERATED by tools/gen-osd-assets.mjs from ArduPilot AP_OSD — do not edit.
export type SymbolSet = Record<string, number>;
/** ArduPilot's own font table (MAX7456, SITL, and DisplayPort with ArduPilot HD fonts). */
export const AP_SYMBOLS: SymbolSet = ${JSON.stringify(ap)};
/** Betaflight-compatible table, used on MSP DisplayPort when MSP_OPTIONS enables BTFL symbols. */
export const BF_SYMBOLS: SymbolSet = ${JSON.stringify(bf)};
/** Packed-decimal glyph offsets (OSD_OPTIONS bit 0, ArduPilot fonts only). */
export const DIG_OFS_1 = ${parseInt(digOfs[1], 16)};
export const DIG_OFS_2 = ${parseInt(digOfs[2], 16)};

export interface OsdFont { id: string; label: string; kind: 'sd' | 'hd'; symbols: 'ap' | 'bf'; family?: string }
export const OSD_FONTS: OsdFont[] = ${JSON.stringify(fonts, null, 1)};
`;
writeFileSync(join(root, 'src/ui/setup/osdSymbols.ts'), ts);
console.log(`${fonts.length} fonts, ${Object.keys(ap).length} AP symbols, ${Object.keys(bf).length} BF symbols`);
