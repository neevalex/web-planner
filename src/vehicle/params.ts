// MAVLink parameter protocol: full download with gap filling, verified writes.
import { MAV_PARAM_TYPE, type MessageMap } from '../mavlink/generated';
import type { Vehicle } from './vehicle';

export interface Param { name: string; value: number; type: number; index: number }

export interface ParamProgress { received: number; total: number; done: boolean; error?: string }

type Listener = () => void;

const INT_TYPES = new Set<number>([
  MAV_PARAM_TYPE.MAV_PARAM_TYPE_UINT8, MAV_PARAM_TYPE.MAV_PARAM_TYPE_INT8,
  MAV_PARAM_TYPE.MAV_PARAM_TYPE_UINT16, MAV_PARAM_TYPE.MAV_PARAM_TYPE_INT16,
  MAV_PARAM_TYPE.MAV_PARAM_TYPE_UINT32, MAV_PARAM_TYPE.MAV_PARAM_TYPE_INT32,
]);

export const isIntType = (t: number) => INT_TYPES.has(t);

/** Values travel as float32 — compare at that precision. */
export const sameValue = (a: number, b: number) => Math.fround(a) === Math.fround(b);

/** Shortest decimal string that round-trips through float32 (0.135 instead of 0.13500000536). */
export function formatValue(v: number, type?: number): string {
  if (type !== undefined && isIntType(type)) return String(Math.round(v));
  if (Number.isInteger(v)) return String(v);
  for (let p = 1; p <= 9; p++) {
    const s = Number(v.toPrecision(p));
    if (Math.fround(s) === Math.fround(v)) return String(s);
  }
  return String(v);
}

export class ParamManager {
  readonly params = new Map<string, Param>();
  progress: ParamProgress = { received: 0, total: 0, done: false };
  private byIndex: (string | undefined)[] = [];
  private listeners = new Set<Listener>();
  private changeListeners = new Set<(p: Param) => void>();
  private lastRx = 0;
  private fetchToken = 0;

  constructor(private vehicle: Vehicle) {
    vehicle.on('PARAM_VALUE', (d) => this.onParamValue(d));
  }

  get loaded() { return this.progress.done && !this.progress.error; }

  onUpdate(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onChange(fn: (p: Param) => void) { this.changeListeners.add(fn); return () => this.changeListeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(); }

  reset() {
    this.fetchToken++;
    this.params.clear();
    this.byIndex = [];
    this.progress = { received: 0, total: 0, done: false };
    this.emit();
  }

  get(name: string) { return this.params.get(name); }

  private onParamValue(d: MessageMap['PARAM_VALUE']) {
    this.lastRx = performance.now();
    const name = d.param_id;
    const existing = this.params.get(name);
    const index = d.param_index === 65535 ? existing?.index ?? -1 : d.param_index;
    const p: Param = { name, value: d.param_value, type: d.param_type, index };
    this.params.set(name, p);
    if (d.param_count && d.param_count !== 65535 && !this.progress.done) this.progress.total = d.param_count;
    if (index >= 0 && index < 65535) {
      if (this.byIndex[index] === undefined) this.progress.received++;
      this.byIndex[index] = name;
    }
    if (existing && !sameValue(existing.value, p.value)) for (const fn of this.changeListeners) fn(p);
    this.emit();
  }

  /** Downloads all parameters, re-requesting any the vehicle (or a lossy link) skipped. */
  async fetchAll(): Promise<void> {
    this.reset();
    const token = this.fetchToken;
    const stale = () => token !== this.fetchToken;
    this.lastRx = performance.now();
    this.vehicle.send('PARAM_REQUEST_LIST', this.vehicle.target);

    // Phase 1: let the stream flow until it goes quiet.
    const start = performance.now();
    while (!stale()) {
      await sleep(200);
      if (this.progress.total && this.progress.received >= this.progress.total) break;
      const quiet = performance.now() - this.lastRx;
      if (this.progress.total === 0 && performance.now() - start > 6000) {
        this.progress = { ...this.progress, done: true, error: 'Vehicle did not send parameters' };
        this.emit();
        return;
      }
      if (this.progress.total && quiet > 1000) break;
      if (!this.progress.total && quiet > 3000) this.vehicle.send('PARAM_REQUEST_LIST', this.vehicle.target);
    }

    // Phase 2: fill gaps by index, a few at a time.
    for (let pass = 0; pass < 10 && !stale(); pass++) {
      const missing: number[] = [];
      for (let i = 0; i < this.progress.total; i++) if (this.byIndex[i] === undefined) missing.push(i);
      if (!missing.length) break;
      const BATCH = 10;
      for (let i = 0; i < missing.length && !stale(); i += BATCH) {
        const batch = missing.slice(i, i + BATCH).filter((idx) => this.byIndex[idx] === undefined);
        if (!batch.length) continue;
        for (const idx of batch) {
          this.vehicle.send('PARAM_REQUEST_READ', { ...this.vehicle.target, param_id: '', param_index: idx });
        }
        // Move on once every reply is in, or the link has gone quiet (a reply was lost — next pass retries it).
        const t0 = performance.now();
        for (;;) {
          await sleep(20);
          if (stale()) break;
          const now = performance.now();
          if (batch.every((idx) => this.byIndex[idx] !== undefined)) break;
          if (now - t0 > 1500 || (now - t0 > 150 && now - this.lastRx > 150)) break;
        }
      }
    }
    if (stale()) return;
    const missingCount = this.progress.total - this.progress.received;
    this.progress = {
      ...this.progress, done: true,
      error: missingCount > 0 ? `${missingCount} parameters could not be read` : undefined,
    };
    this.emit();
  }

  /** Writes one parameter and confirms the vehicle accepted it. Returns the value the vehicle reports. */
  async set(name: string, value: number, retries = 3): Promise<number> {
    const p = this.params.get(name);
    const type = p?.type ?? MAV_PARAM_TYPE.MAV_PARAM_TYPE_REAL32;
    const v = isIntType(type) ? Math.round(value) : value;
    for (let attempt = 0; attempt < retries; attempt++) {
      const reply = this.vehicle.waitFor('PARAM_VALUE', (d) => d.param_id === name, 1200);
      this.vehicle.send('PARAM_SET', { ...this.vehicle.target, param_id: name, param_value: v, param_type: type });
      try {
        const d = await reply;
        if (!sameValue(d.param_value, v)) {
          throw new ParamRejected(name, v, d.param_value);
        }
        return d.param_value;
      } catch (e) {
        if (e instanceof ParamRejected) throw e;
      }
    }
    throw new Error(`No reply writing ${name}`);
  }

  /** Writes several params in sequence. Collects failures instead of stopping at the first. */
  async setMany(values: [string, number][], onProgress?: (done: number, total: number) => void) {
    const failed: { name: string; error: string }[] = [];
    let done = 0;
    for (const [name, value] of values) {
      try { await this.set(name, value); } catch (e) { failed.push({ name, error: (e as Error).message }); }
      onProgress?.(++done, values.length);
    }
    return failed;
  }

  async refresh(name: string, retries = 3) {
    for (let attempt = 0; ; attempt++) {
      const reply = this.vehicle.waitFor('PARAM_VALUE', (d) => d.param_id === name, 1200);
      this.vehicle.send('PARAM_REQUEST_READ', { ...this.vehicle.target, param_id: name, param_index: -1 });
      try { return await reply; } catch (e) { if (attempt + 1 >= retries) throw e; }
    }
  }
}

export class ParamRejected extends Error {
  constructor(public name: string, public wanted: number, public actual: number) {
    super(`${name}: vehicle kept ${formatValue(actual)} (wanted ${formatValue(wanted)}) — out of range or read-only?`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
