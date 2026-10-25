// Staged parameter changes, shared by the Parameters page and every setup page.
// Nothing reaches the vehicle until writeAll(); each write is verified.
import { formatValue, isIntType, sameValue } from '../vehicle/params';
import type { Vehicle } from '../vehicle/vehicle';
import type { MetaStore } from './meta';

type Listener = (names: string[] | null) => void;

export class Staging {
  readonly pending = new Map<string, number>();
  readonly rebootNeeded = new Set<string>();
  writing = false;
  private listeners = new Set<Listener>();

  constructor(readonly vehicle: Vehicle, readonly meta: MetaStore) {
    vehicle.params.onUpdate(() => {
      if (vehicle.params.params.size === 0 && this.pending.size) { this.pending.clear(); this.emit(null); }
    });
  }

  onChange(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(names: string[] | null) { for (const fn of this.listeners) fn(names); }

  /** Value the user sees: staged if there is one, otherwise what the vehicle has. */
  value(name: string): number | undefined {
    return this.pending.get(name) ?? this.vehicle.params.get(name)?.value;
  }
  isPending(name: string) { return this.pending.has(name); }

  stage(name: string, value: number) {
    const p = this.vehicle.params.get(name);
    if (!p) return;
    if (Number.isFinite(value) && sameValue(value, p.value)) this.pending.delete(name);
    else this.pending.set(name, value);
    this.emit([name]);
  }

  stageMany(values: [string, number][]) {
    for (const [name, value] of values) {
      const p = this.vehicle.params.get(name);
      if (!p) continue;
      if (Number.isFinite(value) && sameValue(value, p.value)) this.pending.delete(name);
      else this.pending.set(name, value);
    }
    this.emit(values.map(([n]) => n));
  }

  unstage(name: string) { if (this.pending.delete(name)) this.emit([name]); }

  discard() {
    const names = [...this.pending.keys()];
    this.pending.clear();
    this.emit(names);
  }

  /** Problems that block writing (not a number, fraction for an integer param). */
  invalid(): string[] {
    return [...this.pending].filter(([name, v]) => {
      const p = this.vehicle.params.get(name);
      return !p || !Number.isFinite(v) || (isIntType(p.type) && !Number.isInteger(v));
    }).map(([n]) => n);
  }

  outOfRange(): string[] {
    return [...this.pending].filter(([name, v]) => {
      const r = this.meta.get(name)?.r;
      return !!r && Number.isFinite(v) && (v < r[0] || v > r[1]);
    }).map(([n]) => n);
  }

  async writeAll(onProgress?: (done: number, total: number) => void) {
    const entries = [...this.pending];
    this.writing = true;
    this.emit(null);
    const failed = await this.vehicle.params.setMany(entries, onProgress);
    this.writing = false;
    const failedNames = new Set(failed.map((f) => f.name));
    for (const [name, value] of entries) {
      const f = failed.find((x) => x.name === name);
      if (f) { this.vehicle.log(`Write failed: ${f.error}`, 3); continue; }
      this.pending.delete(name);
      if (this.meta.get(name)?.rb) this.rebootNeeded.add(name);
      this.vehicle.log(`Set ${name} = ${formatValue(value, this.vehicle.params.get(name)?.type)}`);
    }
    this.emit(entries.map(([n]) => n));
    return { written: entries.length - failedNames.size, failed };
  }

  clearReboot() { this.rebootNeeded.clear(); this.emit(null); }

  /** Something other than a parameter write needs a reboot (e.g. a calibration). */
  requireReboot(reason: string) { this.rebootNeeded.add(reason); this.emit(null); }
}
