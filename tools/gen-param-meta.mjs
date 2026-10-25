#!/usr/bin/env node
// Compacts ArduPilot apm.pdef.json files into public/param-meta/<vehicle>.json
//
// Produce the inputs from an ArduPilot checkout:
//   cd ardupilot/Tools/autotest/param_metadata
//   python3 param_parse.py --vehicle ArduCopter --format json   # -> apm.pdef.json
// then:
//   node tools/gen-param-meta.mjs copter Copter-4.7.2=a.json Copter-4.6.3=b.json master=c.json
//
// Several versions can be given; the FIRST one that defines a parameter wins, so list the
// current stable release first. Later ones fill in params that were renamed or added,
// so the editor has docs for both older and newer firmware.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [vehicle, ...inputs] = process.argv.slice(2);
if (!vehicle || !inputs.length) {
  console.error('usage: gen-param-meta.mjs <copter|plane|rover> <label>=<apm.pdef.json> ...');
  process.exit(1);
}
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/param-meta');
mkdirSync(outDir, { recursive: true });

const params = {};
const sources = [];
for (const spec of inputs) {
  const [label, file] = spec.includes('=') ? spec.split('=') : [spec, spec];
  const before = Object.keys(params).length;
  mergeFrom(JSON.parse(readFileSync(file, 'utf8')));
  sources.push(`${label} (+${Object.keys(params).length - before})`);
}

function mergeFrom(pdef) {
for (const group of Object.values(pdef)) {
  if (typeof group !== 'object' || group === null) continue;
  for (const [name, m] of Object.entries(group)) {
    if (typeof m !== 'object' || !m || name in params) continue;
    const e = {};
    if (m.DisplayName) e.n = m.DisplayName;
    if (m.Description) e.d = m.Description;
    if (m.Units) e.u = m.Units;
    if (m.Range) e.r = [Number(m.Range.low), Number(m.Range.high)];
    if (m.Increment) e.i = Number(m.Increment);
    // Some params are documented by several backends (e.g. analog and AD7091R5 battery monitors);
    // the last one wins in apm.pdef.json, so strip backend-specific wording.
    if (e.n) e.n = clean(e.n);
    if (e.d) e.d = clean(e.d);
    if (m.Values && Object.keys(m.Values).length) e.v = Object.fromEntries(Object.entries(m.Values).sort((a, b) => Number(a[0]) - Number(b[0])));
    if (m.Bitmask && Object.keys(m.Bitmask).length) e.b = Object.fromEntries(Object.entries(m.Bitmask).sort((a, b) => Number(a[0]) - Number(b[0])));
    if (m.RebootRequired === 'True') e.rb = 1;
    if (m.ReadOnly === 'True') e.ro = 1;
    if (m.User === 'Advanced') e.adv = 1;
    params[name] = e;
  }
}
}

function clean(t) {
  return t.replace(/\s+(on the |on )?AD7091R5( Ic)?/g, '').replace(/\s{2,}/g, ' ').trim();
}

const out = { vehicle, sources, generated: new Date().toISOString().slice(0, 10), params };
const file = resolve(outDir, `${vehicle}.json`);
writeFileSync(file, JSON.stringify(out));
console.log(`${vehicle}: ${Object.keys(params).length} params from ${sources.join(', ')} -> ${file}`);
