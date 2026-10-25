// Vehicle connection: owns a transport, parses MAVLink, keeps the state store current,
// sends GCS heartbeats, and provides command / mode / arm helpers.

import { MavlinkParser, encodeFrame, type Packet } from '../mavlink/codec';
import {
  MAV_AUTOPILOT, MAV_CMD, MAV_COMPONENT, MAV_MODE_FLAG, MAV_RESULT, MAV_TYPE, MAV_STATE,
  type MessageMap, type MessageName,
} from '../mavlink/generated';
import type { Transport } from '../transport/transport';
import { modeName, vehicleClassOf } from './modes';
import { ParamManager } from './params';
import { Store, type StatusMessage } from './state';

export const GCS_SYSID = 255;
export const GCS_COMPID = MAV_COMPONENT.MAV_COMP_ID_MISSIONPLANNER;
const HEARTBEAT_TIMEOUT_MS = 3500;

type Handler<N extends MessageName> = (data: MessageMap[N], pkt: Packet<N>) => void;

export interface CommandOptions { timeoutMs?: number; retries?: number }

export class Vehicle {
  readonly store = new Store();
  readonly params: ParamManager;
  private transport: Transport | null = null;
  private parser = new MavlinkParser();
  private seq = 0;
  private handlers = new Map<string, Set<Handler<never>>>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private statusChunks = new Map<number, { parts: string[]; severity: number; time: number }>();
  private lastRateSample = { t: 0, rx: 0, tx: 0, packets: 0, dropped: 0 };

  constructor() {
    this.params = new ParamManager(this);
    this.on('HEARTBEAT', (d, p) => this.onHeartbeat(d, p));
    this.on('ATTITUDE', (d) => this.store.update({ roll: d.roll, pitch: d.pitch, yaw: d.yaw }));
    this.on('GLOBAL_POSITION_INT', (d) => {
      const lat = d.lat / 1e7, lon = d.lon / 1e7;
      const home = this.store.state.home;
      this.store.update({
        lat: d.lat === 0 && d.lon === 0 ? null : lat,
        lon: d.lat === 0 && d.lon === 0 ? null : lon,
        altMsl: d.alt / 1000, altRel: d.relative_alt / 1000,
        heading: d.hdg === 65535 ? this.store.state.heading : d.hdg / 100,
        distToHome: home ? haversine(home.lat, home.lon, lat, lon) : null,
      });
    });
    this.on('VFR_HUD', (d) => this.store.update({
      groundspeed: d.groundspeed, airspeed: d.airspeed, climb: d.climb, throttle: d.throttle, heading: d.heading,
    }));
    this.on('GPS_RAW_INT', (d) => this.store.update({
      gpsFix: d.fix_type, gpsSats: d.satellites_visible === 255 ? 0 : d.satellites_visible,
      gpsHdop: d.eph === 65535 ? 99 : d.eph / 100,
    }));
    this.on('SYS_STATUS', (d) => this.store.update({
      batteryVoltage: d.voltage_battery === 65535 ? 0 : d.voltage_battery / 1000,
      batteryCurrent: d.current_battery === -1 ? -1 : d.current_battery / 100,
      batteryRemaining: d.battery_remaining,
    }));
    this.on('EKF_STATUS_REPORT', (d) => {
      // attitude + horiz vel + vert vel + horiz pos rel + vert pos all OK, no const_pos_mode
      const required = 0x01 | 0x02 | 0x04 | 0x08 | 0x20;
      this.store.update({ ekfOk: (d.flags & required) === required && (d.flags & 0x80) === 0 });
    });
    this.on('HOME_POSITION', (d) => this.store.update({ home: { lat: d.latitude / 1e7, lon: d.longitude / 1e7, alt: d.altitude / 1000 } }));
    this.on('AUTOPILOT_VERSION', (d) => {
      const v = d.flight_sw_version;
      const typeNames: Record<number, string> = { 0: 'dev', 64: 'alpha', 128: 'beta', 192: 'rc', 255: '' };
      const t = typeNames[v & 0xff] ?? '';
      const vehicleWord = { copter: 'ArduCopter', plane: 'ArduPlane', rover: 'ArduRover', unknown: 'ArduPilot' }[this.store.state.vehicleClass];
      this.store.update({ firmware: `${vehicleWord} V${(v >>> 24) & 0xff}.${(v >> 16) & 0xff}.${(v >> 8) & 0xff}${t ? '-' + t : ''}` });
    });
    this.on('STATUSTEXT', (d) => this.onStatusText(d));
  }

  get target() { return { target_system: this.store.state.sysid, target_component: this.store.state.compid }; }
  get connected() { return this.store.state.link === 'connected'; }

  // ---------- message plumbing ----------

  on<N extends MessageName>(name: N, fn: Handler<N>): () => void {
    let set = this.handlers.get(name);
    if (!set) { set = new Set(); this.handlers.set(name, set); }
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  /** Resolves with the first matching message, or rejects on timeout. */
  waitFor<N extends MessageName>(name: N, match: (d: MessageMap[N]) => boolean, timeoutMs: number): Promise<MessageMap[N]> {
    return new Promise((resolve, reject) => {
      const off = this.on(name, (d) => { if (match(d)) { clearTimeout(t); off(); resolve(d); } });
      const t = setTimeout(() => { off(); reject(new Error(`timeout waiting for ${name}`)); }, timeoutMs);
    });
  }

  send<N extends MessageName>(name: N, data: Partial<MessageMap[N]>) {
    if (!this.transport) return;
    const frame = encodeFrame(name, data, { sysid: GCS_SYSID, compid: GCS_COMPID, seq: this.seq++ });
    this.transport.write(frame).catch((e) => console.warn('write failed', e));
  }

  private dispatch(pkt: Packet) {
    // Only accept traffic from our vehicle once we've picked one (GCS heartbeats etc. are ignored).
    const s = this.store.state;
    if (pkt.name !== 'HEARTBEAT' && s.sysid && pkt.sysid !== s.sysid) return;
    const set = this.handlers.get(pkt.name);
    if (set) for (const fn of set) {
      try { (fn as Handler<MessageName>)(pkt.data as never, pkt as never); } catch (e) { console.error(pkt.name, e); }
    }
  }

  // ---------- connection lifecycle ----------

  async connect(transport: Transport) {
    await this.disconnect();
    this.parser = new MavlinkParser();
    this.store.reset({ link: 'connecting', linkLabel: transport.label, linkError: null });
    this.transport = transport;
    transport.onData((chunk) => { for (const p of this.parser.push(chunk)) this.dispatch(p); });
    transport.onClose((reason) => {
      if (this.transport !== transport) return;
      this.cleanup();
      this.store.update({ link: 'disconnected', linkError: reason ?? null });
    });
    try {
      await transport.open();
    } catch (e) {
      this.transport = null;
      this.store.update({ link: 'disconnected', linkError: (e as Error).message });
      throw e;
    }
    this.store.update({ link: 'waiting', linkLabel: transport.label });
    this.sendGcsHeartbeat();
    this.timers.push(setInterval(() => this.sendGcsHeartbeat(), 1000));
    this.timers.push(setInterval(() => this.watchdog(), 500));
  }

  async disconnect() {
    const t = this.transport;
    this.cleanup();
    if (t) await t.close().catch(() => {});
    this.store.update({ link: 'disconnected' });
  }

  private cleanup() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.transport = null;
    this.params.reset();
  }

  private sendGcsHeartbeat() {
    this.send('HEARTBEAT', {
      type: MAV_TYPE.MAV_TYPE_GCS, autopilot: MAV_AUTOPILOT.MAV_AUTOPILOT_INVALID,
      base_mode: 0, custom_mode: 0, system_status: MAV_STATE.MAV_STATE_ACTIVE, mavlink_version: 3,
    });
  }

  private watchdog() {
    const s = this.store.state;
    const now = performance.now();
    if (s.link === 'connected' && now - s.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) this.store.update({ link: 'lost' });
    if (this.transport && now - this.lastRateSample.t >= 1000) {
      const dt = (now - this.lastRateSample.t) / 1000;
      const { packets, dropped } = this.parser.stats;
      const dp = packets - this.lastRateSample.packets, dd = dropped - this.lastRateSample.dropped;
      this.store.update({
        rxRate: (this.transport.bytesIn - this.lastRateSample.rx) / dt,
        txRate: (this.transport.bytesOut - this.lastRateSample.tx) / dt,
        packetLoss: dp + dd > 0 ? (100 * dd) / (dp + dd) : 0,
      });
      this.lastRateSample = { t: now, rx: this.transport.bytesIn, tx: this.transport.bytesOut, packets, dropped };
    }
  }

  private onHeartbeat(d: MessageMap['HEARTBEAT'], p: Packet<'HEARTBEAT'>) {
    const s = this.store.state;
    // Ignore GCSs, gimbals, cameras, etc. — we want the autopilot.
    if (d.autopilot === MAV_AUTOPILOT.MAV_AUTOPILOT_INVALID || d.type === MAV_TYPE.MAV_TYPE_GCS) return;
    if (s.sysid && p.sysid !== s.sysid) return;
    if (s.compid && p.compid !== s.compid) return;
    const first = !s.sysid || s.link === 'waiting';
    const vehicleClass = vehicleClassOf(d.type);
    this.store.update({
      link: 'connected',
      sysid: p.sysid, compid: p.compid,
      mavType: d.type, vehicleClass,
      armed: (d.base_mode & MAV_MODE_FLAG.MAV_MODE_FLAG_SAFETY_ARMED) !== 0,
      customMode: d.custom_mode,
      modeName: modeName(vehicleClass, d.custom_mode),
      systemStatus: d.system_status,
      lastHeartbeat: performance.now(),
    });
    if (first) this.onFirstHeartbeat();
  }

  private onFirstHeartbeat() {
    this.requestStreams();
    void this.requestMessage(148 /* AUTOPILOT_VERSION */);
    void this.requestMessage(242 /* HOME_POSITION */);
    void this.params.fetchAll();
  }

  /** Legacy stream groups — supported by every ArduPilot version and honoured by SRx_ params. */
  requestStreams() {
    const rates: [number, number][] = [
      [1, 2],   // RAW_SENSORS
      [2, 2],   // EXTENDED_STATUS: SYS_STATUS, GPS_RAW_INT, EKF...
      [3, 2],   // RC_CHANNELS
      [6, 3],   // POSITION: GLOBAL_POSITION_INT
      [10, 10], // EXTRA1: ATTITUDE
      [11, 4],  // EXTRA2: VFR_HUD
      [12, 2],  // EXTRA3: EKF_STATUS_REPORT, battery, vibration...
    ];
    for (const [id, hz] of rates) {
      this.send('REQUEST_DATA_STREAM', { ...this.target, req_stream_id: id, req_message_rate: hz, start_stop: 1 });
    }
  }

  // ---------- commands ----------

  async command(cmd: number, params: number[] = [], opts: CommandOptions = {}): Promise<number> {
    const timeoutMs = opts.timeoutMs ?? 1500;
    const retries = opts.retries ?? 3;
    const p = [...params, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
    for (let attempt = 0; attempt < retries; attempt++) {
      const ack = this.waitFor('COMMAND_ACK', (a) => a.command === cmd, timeoutMs);
      this.send('COMMAND_LONG', {
        ...this.target, command: cmd, confirmation: attempt,
        param1: p[0], param2: p[1], param3: p[2], param4: p[3], param5: p[4], param6: p[5], param7: p[6],
      });
      try {
        let a = await ack;
        // IN_PROGRESS: keep waiting for the final result
        while (a.result === MAV_RESULT.MAV_RESULT_IN_PROGRESS) {
          a = await this.waitFor('COMMAND_ACK', (x) => x.command === cmd, Math.max(timeoutMs, 5000));
        }
        return a.result;
      } catch { /* timeout → retry */ }
    }
    throw new Error(`No response to command ${commandName(cmd)}`);
  }

  async requestMessage(msgid: number) {
    try { return await this.command(MAV_CMD.MAV_CMD_REQUEST_MESSAGE, [msgid], { retries: 2 }); } catch { return -1; }
  }

  setMode(customMode: number) {
    return this.command(MAV_CMD.MAV_CMD_DO_SET_MODE, [MAV_MODE_FLAG.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode]);
  }

  arm(arm: boolean, force = false) {
    return this.command(MAV_CMD.MAV_CMD_COMPONENT_ARM_DISARM, [arm ? 1 : 0, force ? 21196 : 0]);
  }

  reboot() {
    return this.command(MAV_CMD.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, [1], { retries: 1 });
  }

  // ---------- STATUSTEXT ----------

  private onStatusText(d: MessageMap['STATUSTEXT']) {
    const id = d.id ?? 0;
    const add = (text: string, severity: number) => {
      const msg: StatusMessage = { time: Date.now(), severity, text };
      this.store.update({ messages: [...this.store.state.messages.slice(-499), msg] });
    };
    if (!id) { add(d.text, d.severity); return; }
    // Multi-chunk message: chunks are 50 chars; the last chunk is shorter (or followed by nothing).
    let entry = this.statusChunks.get(id);
    if (!entry) {
      entry = { parts: [], severity: d.severity, time: Date.now() };
      this.statusChunks.set(id, entry);
      // A text that is an exact multiple of 50 chars has no short final chunk; flush it after a moment.
      const e = entry;
      setTimeout(() => { if (this.statusChunks.get(id) === e) { this.statusChunks.delete(id); add(e.parts.join(''), e.severity); } }, 1000);
    }
    entry.parts[d.chunk_seq ?? 0] = d.text;
    if (d.text.length < 50) {
      add(entry.parts.join(''), entry.severity);
      this.statusChunks.delete(id);
    }
  }
}

export function commandName(cmd: number): string {
  const e = Object.entries(MAV_CMD).find(([, v]) => v === cmd);
  return e ? e[0].replace('MAV_CMD_', '') : String(cmd);
}

export function resultName(r: number): string {
  const e = Object.entries(MAV_RESULT).find(([, v]) => v === r);
  return e ? e[0].replace('MAV_RESULT_', '').toLowerCase().replace(/_/g, ' ') : String(r);
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
