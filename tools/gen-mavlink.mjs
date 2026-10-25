#!/usr/bin/env node
// Generates src/mavlink/generated.ts from MAVLink XML dialect definitions.
// Usage: node tools/gen-mavlink.mjs [dialect.xml]   (default: ardupilotmega.xml)
//
// Output contains, per message: id, name, CRC_EXTRA, and fields in WIRE order
// (base fields sorted by type size, extensions appended in XML order), plus
// TypeScript interfaces and enum constants.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const here = dirname(fileURLToPath(import.meta.url));
const xmlDir = join(here, 'mavlink-xml');
const outFile = resolve(here, '../src/mavlink/generated.ts');
const rootDialect = process.argv[2] ?? 'ardupilotmega.xml';

const TYPE_SIZE = {
  int8_t: 1, uint8_t: 1, char: 1,
  int16_t: 2, uint16_t: 2,
  int32_t: 4, uint32_t: 4, float: 4,
  int64_t: 8, uint64_t: 8, double: 8,
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  trimValues: true,
});

const enums = new Map();     // name -> { name, bitmask, entries: Map(name -> value) }
const messages = new Map();  // id -> message
const seenFiles = new Set();

function attrs(node) { return node[':@'] ?? {}; }
function tag(node) { return Object.keys(node).find((k) => k !== ':@'); }
function textOf(children) {
  return (children ?? []).filter((c) => '#text' in c).map((c) => String(c['#text'])).join('');
}

function loadFile(file) {
  if (seenFiles.has(file)) return;
  seenFiles.add(file);
  const doc = parser.parse(readFileSync(join(xmlDir, file), 'utf8'));
  const root = doc.find((n) => tag(n) === 'mavlink');
  for (const node of root.mavlink) {
    const t = tag(node);
    if (t === 'include') loadFile(textOf(node.include).trim());
  }
  for (const node of root.mavlink) {
    const t = tag(node);
    if (t === 'enums') for (const e of node.enums) if (tag(e) === 'enum') addEnum(e);
    if (t === 'messages') for (const m of node.messages) if (tag(m) === 'message') addMessage(m, file);
  }
}

function addEnum(node) {
  const a = attrs(node);
  let en = enums.get(a.name);
  if (!en) { en = { name: a.name, bitmask: a.bitmask === 'true', entries: new Map() }; enums.set(a.name, en); }
  let next = 0;
  for (const child of node.enum) {
    if (tag(child) !== 'entry') continue;
    const ea = attrs(child);
    const value = ea.value !== undefined ? Number(ea.value) : next;
    next = value + 1;
    en.entries.set(ea.name, value);
  }
}

function parseType(raw) {
  // e.g. "uint8_t", "char[16]", "float[4]", "uint8_t_mavlink_version"
  const m = /^([a-z0-9_]+?)(?:\[(\d+)\])?$/.exec(raw);
  if (!m) throw new Error(`bad type ${raw}`);
  let base = m[1];
  if (base === 'uint8_t_mavlink_version') base = 'uint8_t';
  if (!(base in TYPE_SIZE)) throw new Error(`unknown type ${raw}`);
  return { base, len: m[2] ? Number(m[2]) : 0 };
}

function addMessage(node, file) {
  const a = attrs(node);
  const id = Number(a.id);
  const fields = [];
  let inExtensions = false;
  for (const child of node.message) {
    const t = tag(child);
    if (t === 'extensions') { inExtensions = true; continue; }
    if (t !== 'field') continue;
    const fa = attrs(child);
    const { base, len } = parseType(fa.type);
    fields.push({ name: fa.name, type: base, len, ext: inExtensions, enum: fa.enum });
  }
  if (messages.has(id) && messages.get(id).name !== a.name) {
    throw new Error(`message id ${id} clash: ${messages.get(id).name} vs ${a.name}`);
  }
  // Wire order: base fields sorted by element size (desc, stable); extensions keep XML order.
  const base = fields.filter((f) => !f.ext);
  const ext = fields.filter((f) => f.ext);
  const wireBase = base
    .map((f, i) => ({ f, i }))
    .sort((x, y) => TYPE_SIZE[y.f.type] - TYPE_SIZE[x.f.type] || x.i - y.i)
    .map((x) => x.f);
  const wire = [...wireBase, ...ext];
  messages.set(id, { id, name: a.name, file, fields: wire, crcExtra: crcExtra(a.name, wireBase) });
}

// X.25 / MCRF4XX CRC used by MAVLink
function crcAccumulate(byte, crc) {
  let tmp = byte ^ (crc & 0xff);
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}
function crcString(s, crc) {
  for (const ch of Buffer.from(s, 'ascii')) crc = crcAccumulate(ch, crc);
  return crc;
}
function crcExtra(name, wireBase) {
  let crc = crcString(name + ' ', 0xffff);
  for (const f of wireBase) {
    crc = crcString(f.type + ' ', crc);
    crc = crcString(f.name + ' ', crc);
    if (f.len) crc = crcAccumulate(f.len, crc);
  }
  return (crc & 0xff) ^ (crc >> 8);
}

function tsType(f) {
  if (f.type === 'char' && f.len) return 'string';
  const scalar = f.type === 'int64_t' || f.type === 'uint64_t' ? 'bigint' : 'number';
  return f.len ? `${scalar}[]` : scalar;
}

loadFile(rootDialect);

const msgList = [...messages.values()].sort((a, b) => a.id - b.id);
const enumList = [...enums.values()].sort((a, b) => a.name.localeCompare(b.name));

let out = '';
out += `// AUTO-GENERATED by tools/gen-mavlink.mjs from ${rootDialect} — do not edit.\n`;
out += `/* eslint-disable */\n\n`;
out += `export type FieldType = 'int8_t' | 'uint8_t' | 'char' | 'int16_t' | 'uint16_t' | 'int32_t' | 'uint32_t' | 'float' | 'int64_t' | 'uint64_t' | 'double';\n`;
out += `/** [name, type, arrayLength (0 = scalar), isExtension] in wire order */\n`;
out += `export type FieldDef = readonly [string, FieldType, number, boolean];\n`;
out += `export interface MessageDef { readonly id: number; readonly name: string; readonly crcExtra: number; readonly fields: readonly FieldDef[] }\n\n`;

out += `export const MESSAGE_DEFS: Readonly<Record<number, MessageDef>> = {\n`;
for (const m of msgList) {
  const f = m.fields.map((x) => `['${x.name}','${x.type}',${x.len},${x.ext}]`).join(',');
  out += `  ${m.id}: { id: ${m.id}, name: '${m.name}', crcExtra: ${m.crcExtra}, fields: [${f}] },\n`;
}
out += `};\n\n`;

out += `export const MSG_ID = {\n`;
for (const m of msgList) out += `  ${m.name}: ${m.id},\n`;
out += `} as const;\nexport type MessageName = keyof typeof MSG_ID;\n\n`;

for (const m of msgList) {
  out += `export interface ${m.name} {\n`;
  for (const f of m.fields) out += `  ${f.name}${f.ext ? '?' : ''}: ${tsType(f)};\n`;
  out += `}\n`;
}
out += `\nexport interface MessageMap {\n`;
for (const m of msgList) out += `  ${m.name}: ${m.name};\n`;
out += `}\n\n`;

for (const e of enumList) {
  out += `export const ${e.name} = {\n`;
  for (const [k, v] of e.entries) out += `  ${k}: ${v},\n`;
  out += `} as const;\n`;
}

writeFileSync(outFile, out);
console.log(`Generated ${msgList.length} messages, ${enumList.length} enums from ${seenFiles.size} files -> ${outFile}`);
