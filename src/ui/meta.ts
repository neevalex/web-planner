// Parameter documentation for the connected vehicle class, shared by every page.
import { loadParamMeta, type ParamMeta } from '../vehicle/paramMeta';
import type { Vehicle } from '../vehicle/vehicle';

export class MetaStore {
  meta: Record<string, ParamMeta> = {};
  private loadedFor = '';
  private listeners = new Set<() => void>();

  constructor(vehicle: Vehicle) {
    vehicle.store.subscribe((s) => {
      if (s.vehicleClass === 'unknown' || s.vehicleClass === this.loadedFor) return;
      this.loadedFor = s.vehicleClass;
      void loadParamMeta(s.vehicleClass).then((m) => { this.meta = m; this.isLoaded = Object.keys(m).length > 0; for (const fn of this.listeners) fn(); });
    });
  }

  get(name: string): ParamMeta | undefined { return this.meta[name]; }
  private isLoaded = false;
  get loaded() { return this.isLoaded; }
  onLoad(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
