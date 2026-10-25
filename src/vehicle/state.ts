// Vehicle state store. Mutate via update(); subscribers are notified once per animation frame.
import type { VehicleClass } from './modes';

export type LinkState = 'disconnected' | 'connecting' | 'waiting' | 'connected' | 'lost';

/** source 'fc' = STATUSTEXT from the autopilot, 'app' = WebPlanner's own events. */
export interface StatusMessage { time: number; severity: number; text: string; source?: 'fc' | 'app' }

/** One battery monitor from BATTERY_STATUS (id 0 = BATT, 1 = BATT2…). */
export interface BatteryInfo {
  voltage: number;            // V
  current: number;            // A, -1 unknown
  consumed: number;           // mAh, -1 unknown
  remaining: number;          // %, -1 unknown
  cells: number[];            // per-cell V when the monitor reports them
  temperature: number | null; // °C
  time: number;               // ms timestamp of last update
}

export interface VehicleState {
  link: LinkState;
  linkLabel: string;
  linkError: string | null;
  sysid: number;
  compid: number;
  mavType: number;
  vehicleClass: VehicleClass;
  firmware: string;
  armed: boolean;
  customMode: number;
  modeName: string;
  systemStatus: number;
  lastHeartbeat: number;

  roll: number; pitch: number; yaw: number;          // radians
  lat: number | null; lon: number | null;            // degrees
  altMsl: number; altRel: number;                    // metres
  heading: number;                                   // degrees
  groundspeed: number; airspeed: number; climb: number; throttle: number;
  gpsFix: number; gpsSats: number; gpsHdop: number;
  batteryVoltage: number; batteryCurrent: number; batteryRemaining: number;
  ekfOk: boolean | null;
  home: { lat: number; lon: number; alt: number } | null;
  distToHome: number | null;

  /** RC input PWM, channel 1 at index 0 (0 = no data). */
  rc: number[]; rcCount: number; rssi: number;
  /** Servo/motor output PWM, output 1 at index 0. */
  servo: number[];
  batteries: Record<number, BatteryInfo>;
  messages: StatusMessage[];
  rxRate: number; txRate: number; packetLoss: number;
}

export const initialState = (): VehicleState => ({
  link: 'disconnected', linkLabel: '', linkError: null,
  sysid: 0, compid: 0, mavType: 0, vehicleClass: 'unknown', firmware: '',
  armed: false, customMode: 0, modeName: '—', systemStatus: 0, lastHeartbeat: 0,
  roll: 0, pitch: 0, yaw: 0,
  lat: null, lon: null, altMsl: 0, altRel: 0, heading: 0,
  groundspeed: 0, airspeed: 0, climb: 0, throttle: 0,
  gpsFix: 0, gpsSats: 0, gpsHdop: 99,
  batteryVoltage: 0, batteryCurrent: -1, batteryRemaining: -1,
  ekfOk: null,
  home: null, distToHome: null,
  rc: [], rcCount: 0, rssi: 255,
  servo: [],
  batteries: {},
  messages: [],
  rxRate: 0, txRate: 0, packetLoss: 0,
});

type Listener = (s: Readonly<VehicleState>) => void;

export class Store {
  state = initialState();
  private listeners = new Set<Listener>();
  private scheduled = false;
  private schedule: (fn: () => void) => void =
    typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);

  update(patch: Partial<VehicleState>) {
    Object.assign(this.state, patch);
    if (!this.scheduled) {
      this.scheduled = true;
      this.schedule(() => {
        this.scheduled = false;
        for (const l of this.listeners) l(this.state);
      });
    }
  }

  reset(patch: Partial<VehicleState> = {}) {
    const messages = this.state.messages;
    this.state = { ...initialState(), messages };
    this.update(patch);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
}
