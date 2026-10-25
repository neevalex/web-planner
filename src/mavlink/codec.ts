// MAVLink v1/v2 framing, payload encoding/decoding driven by generated definitions.

import { MESSAGE_DEFS, MSG_ID, type FieldDef, type FieldType, type MessageDef, type MessageMap, type MessageName } from './generated';

export const MAGIC_V1 = 0xfe;
export const MAGIC_V2 = 0xfd;
const SIGNATURE_LEN = 13;
const IFLAG_SIGNED = 0x01;

const TYPE_SIZE: Record<FieldType, number> = {
  int8_t: 1, uint8_t: 1, char: 1,
  int16_t: 2, uint16_t: 2,
  int32_t: 4, uint32_t: 4, float: 4,
  int64_t: 8, uint64_t: 8, double: 8,
};

export function crcAccumulate(byte: number, crc: number): number {
  let tmp = byte ^ (crc & 0xff);
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

export function crcCalculate(buf: Uint8Array, start: number, end: number, crc = 0xffff): number {
  for (let i = start; i < end; i++) crc = crcAccumulate(buf[i], crc);
  return crc;
}

const payloadLenCache = new Map<number, { full: number; min: number }>();
function payloadLengths(def: MessageDef) {
  let cached = payloadLenCache.get(def.id);
  if (!cached) {
    let full = 0, min = 0;
    for (const [, type, len, ext] of def.fields) {
      const size = TYPE_SIZE[type] * (len || 1);
      full += size;
      if (!ext) min += size;
    }
    cached = { full, min };
    payloadLenCache.set(def.id, cached);
  }
  return cached;
}

export interface Packet<N extends MessageName = MessageName> {
  name: N;
  msgid: number;
  sysid: number;
  compid: number;
  seq: number;
  version: 1 | 2;
  data: MessageMap[N];
}

// ---------- payload ----------

function readScalar(dv: DataView, off: number, type: FieldType): number | bigint {
  switch (type) {
    case 'int8_t': return dv.getInt8(off);
    case 'uint8_t': case 'char': return dv.getUint8(off);
    case 'int16_t': return dv.getInt16(off, true);
    case 'uint16_t': return dv.getUint16(off, true);
    case 'int32_t': return dv.getInt32(off, true);
    case 'uint32_t': return dv.getUint32(off, true);
    case 'float': return dv.getFloat32(off, true);
    case 'double': return dv.getFloat64(off, true);
    case 'int64_t': return dv.getBigInt64(off, true);
    case 'uint64_t': return dv.getBigUint64(off, true);
  }
}

function writeScalar(dv: DataView, off: number, type: FieldType, v: unknown): void {
  switch (type) {
    case 'int8_t': dv.setInt8(off, Number(v ?? 0)); return;
    case 'uint8_t': case 'char': dv.setUint8(off, Number(v ?? 0)); return;
    case 'int16_t': dv.setInt16(off, Number(v ?? 0), true); return;
    case 'uint16_t': dv.setUint16(off, Number(v ?? 0), true); return;
    case 'int32_t': dv.setInt32(off, Number(v ?? 0), true); return;
    case 'uint32_t': dv.setUint32(off, Number(v ?? 0) >>> 0, true); return;
    case 'float': dv.setFloat32(off, Number(v ?? 0), true); return;
    case 'double': dv.setFloat64(off, Number(v ?? 0), true); return;
    case 'int64_t': dv.setBigInt64(off, BigInt((v as bigint | number) ?? 0), true); return;
    case 'uint64_t': dv.setBigUint64(off, BigInt((v as bigint | number) ?? 0), true); return;
  }
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function decodePayload(def: MessageDef, payload: Uint8Array): Record<string, unknown> {
  const { full } = payloadLengths(def);
  // v2 truncates trailing zero bytes; restore them.
  const buf = new Uint8Array(full);
  buf.set(payload.subarray(0, Math.min(payload.length, full)));
  const dv = new DataView(buf.buffer);
  const out: Record<string, unknown> = {};
  let off = 0;
  for (const [name, type, len] of def.fields) {
    const size = TYPE_SIZE[type];
    if (type === 'char' && len) {
      let end = off;
      while (end < off + len && buf[end] !== 0) end++;
      out[name] = textDecoder.decode(buf.subarray(off, end));
    } else if (len) {
      const arr: (number | bigint)[] = new Array(len);
      for (let i = 0; i < len; i++) arr[i] = readScalar(dv, off + i * size, type);
      out[name] = arr;
    } else {
      out[name] = readScalar(dv, off, type);
    }
    off += size * (len || 1);
  }
  return out;
}

export function encodePayload(def: MessageDef, data: Record<string, unknown>): Uint8Array {
  const { full } = payloadLengths(def);
  const buf = new Uint8Array(full);
  const dv = new DataView(buf.buffer);
  let off = 0;
  for (const [name, type, len] of def.fields as readonly FieldDef[]) {
    const size = TYPE_SIZE[type];
    const v = data[name];
    if (type === 'char' && len) {
      const bytes = textEncoder.encode(String(v ?? ''));
      buf.set(bytes.subarray(0, len), off);
    } else if (len) {
      const arr = (v as ArrayLike<unknown>) ?? [];
      for (let i = 0; i < len; i++) writeScalar(dv, off + i * size, type, arr[i]);
    } else {
      writeScalar(dv, off, type, v);
    }
    off += size * (len || 1);
  }
  return buf;
}

// ---------- framing ----------

export interface EncodeOptions { sysid: number; compid: number; seq: number; version?: 1 | 2 }

export function encodeFrame<N extends MessageName>(name: N, data: Partial<MessageMap[N]>, opts: EncodeOptions): Uint8Array {
  const msgid = MSG_ID[name];
  const def = MESSAGE_DEFS[msgid];
  let payload = encodePayload(def, data as Record<string, unknown>);
  const version = opts.version ?? 2;
  if (version === 1) {
    if (msgid > 255) throw new Error(`${name} requires MAVLink 2`);
    payload = payload.subarray(0, payloadLengths(def).min);
    const frame = new Uint8Array(6 + payload.length + 2);
    frame.set([MAGIC_V1, payload.length, opts.seq & 0xff, opts.sysid, opts.compid, msgid]);
    frame.set(payload, 6);
    finishCrc(frame, 1, 6 + payload.length, def.crcExtra);
    return frame;
  }
  // v2: strip trailing zeros (keep at least one byte)
  let len = payload.length;
  while (len > 1 && payload[len - 1] === 0) len--;
  payload = payload.subarray(0, len);
  const frame = new Uint8Array(10 + len + 2);
  frame.set([MAGIC_V2, len, 0, 0, opts.seq & 0xff, opts.sysid, opts.compid, msgid & 0xff, (msgid >> 8) & 0xff, (msgid >> 16) & 0xff]);
  frame.set(payload, 10);
  finishCrc(frame, 1, 10 + len, def.crcExtra);
  return frame;
}

function finishCrc(frame: Uint8Array, start: number, end: number, crcExtra: number) {
  let crc = crcCalculate(frame, start, end);
  crc = crcAccumulate(crcExtra, crc);
  frame[end] = crc & 0xff;
  frame[end + 1] = crc >> 8;
}

export interface ParserStats { packets: number; crcErrors: number; unknown: number; dropped: number }

/** Incremental byte-stream parser. Feed arbitrary chunks; get complete packets. */
export class MavlinkParser {
  private buf = new Uint8Array(4096);
  private len = 0;
  readonly stats: ParserStats = { packets: 0, crcErrors: 0, unknown: 0, dropped: 0 };
  private lastSeq = new Map<number, number>();

  push(chunk: Uint8Array): Packet[] {
    if (this.len + chunk.length > this.buf.length) {
      const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.len + chunk.length));
      bigger.set(this.buf.subarray(0, this.len));
      this.buf = bigger;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;

    const packets: Packet[] = [];
    let pos = 0;
    while (pos < this.len) {
      const magic = this.buf[pos];
      if (magic !== MAGIC_V1 && magic !== MAGIC_V2) { pos++; continue; }
      const headerLen = magic === MAGIC_V2 ? 10 : 6;
      if (this.len - pos < headerLen) break;
      const payloadLen = this.buf[pos + 1];
      const signed = magic === MAGIC_V2 && (this.buf[pos + 2] & IFLAG_SIGNED) !== 0;
      const frameLen = headerLen + payloadLen + 2 + (signed ? SIGNATURE_LEN : 0);
      if (this.len - pos < frameLen) break;

      const msgid = magic === MAGIC_V2
        ? this.buf[pos + 7] | (this.buf[pos + 8] << 8) | (this.buf[pos + 9] << 16)
        : this.buf[pos + 5];
      const def = MESSAGE_DEFS[msgid];
      if (!def) {
        // Can't verify CRC without CRC_EXTRA; skip just the magic byte to stay safe against false syncs.
        this.stats.unknown++;
        pos++;
        continue;
      }
      const crcEnd = pos + headerLen + payloadLen;
      let crc = crcCalculate(this.buf, pos + 1, crcEnd);
      crc = crcAccumulate(def.crcExtra, crc);
      if ((this.buf[crcEnd] | (this.buf[crcEnd + 1] << 8)) !== crc) {
        this.stats.crcErrors++;
        pos++;
        continue;
      }
      const sysid = this.buf[pos + (magic === MAGIC_V2 ? 5 : 3)];
      const compid = this.buf[pos + (magic === MAGIC_V2 ? 6 : 4)];
      const seq = this.buf[pos + (magic === MAGIC_V2 ? 4 : 2)];
      const key = (sysid << 8) | compid;
      const prev = this.lastSeq.get(key);
      if (prev !== undefined) this.stats.dropped += (seq - prev - 1 + 256) % 256;
      this.lastSeq.set(key, seq);

      const payload = this.buf.slice(pos + headerLen, pos + headerLen + payloadLen);
      packets.push({
        name: def.name as MessageName,
        msgid, sysid, compid, seq,
        version: magic === MAGIC_V2 ? 2 : 1,
        data: decodePayload(def, payload) as never,
      });
      this.stats.packets++;
      pos += frameLen;
    }
    this.buf.copyWithin(0, pos, this.len);
    this.len -= pos;
    return packets;
  }
}

export function isPacket<N extends MessageName>(p: Packet, name: N): p is Packet<N> {
  return p.name === name;
}
