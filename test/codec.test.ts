// Cross-checks the TS codec against pymavlink in both directions.
// Run: npx tsx test/codec.test.ts
import { execFileSync } from 'node:child_process';
import { MavlinkParser, encodeFrame } from '../src/mavlink/codec';
import type { MessageName } from '../src/mavlink/generated';

const py = (...args: string[]) => execFileSync('python3', ['test/pymav_vectors.py', ...args], { encoding: 'utf8' });

function norm(v: unknown): unknown {
  if (typeof v === 'bigint') return Math.abs(Number(v)) > 2 ** 53 ? v.toString() : Number(v);
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    return Number.isInteger(v) ? v : Number(v.toPrecision(6));
  }
  return v;
}

function same(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const k of Object.keys(b)) {
    const x = JSON.stringify(norm(a[k] === undefined ? 0 : a[k]));
    const y = JSON.stringify(norm(b[k]));
    if (x !== y) errs.push(`${k}: ours=${x} ref=${y}`);
  }
  return errs;
}

let failures = 0;
const vectors: { name: string; hex: string; fields: Record<string, unknown> }[] = JSON.parse(py('gen'));

// 1) pymavlink-encoded -> our decoder, fed in awkward chunk sizes with garbage in between
const parser = new MavlinkParser();
const stream = Buffer.from('00ff13' + vectors.map((v) => v.hex).join('fe02'), 'hex');
const decoded = [] as ReturnType<MavlinkParser['push']>;
for (let i = 0; i < stream.length; i += 7) decoded.push(...parser.push(stream.subarray(i, i + 7)));

if (decoded.length !== vectors.length) { console.error(`decode count ${decoded.length} != ${vectors.length}`); failures++; }
vectors.forEach((v, i) => {
  const p = decoded[i];
  if (!p || p.name !== v.name) { console.error(`#${i} expected ${v.name} got ${p?.name}`); failures++; return; }
  const errs = same(p.data as unknown as Record<string, unknown>, v.fields);
  if (errs.length) { console.error(`decode ${v.name}:`, errs); failures++; } else console.log(`decode ok  ${v.name}`);
});

// 2) our encoder -> pymavlink decoder (and byte-identical frames where pymavlink also truncates)
let seq = 0;
const ours = vectors.map((v) => {
  const p = decoded.find((d) => d.name === v.name)!;
  return Buffer.from(encodeFrame(v.name as MessageName, p.data as never, { sysid: 1, compid: 1, seq: seq++ }));
});
const back: { name: string; fields: Record<string, unknown> }[] = JSON.parse(py('check', Buffer.concat(ours).toString('hex')));
vectors.forEach((v, i) => {
  const r = back[i];
  if (!r || r.name !== v.name) { console.error(`encode #${i} ${v.name}: pymavlink got ${r?.name}`); failures++; return; }
  const errs = same(r.fields, v.fields);
  const identical = ours[i].toString('hex') === v.hex;
  if (errs.length) { console.error(`encode ${v.name}:`, errs); failures++; } else console.log(`encode ok  ${v.name}${identical ? ' (byte-identical)' : ''}`);
});

console.log(`parser stats`, parser.stats);
if (failures) { console.error(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
