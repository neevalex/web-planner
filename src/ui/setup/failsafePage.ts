// Failsafes: radio, battery, GCS, EKF, geofence and the rest, for copter / plane / rover.
import { formatValue } from '../../vehicle/params';
import { h } from '../dom';
import { icon } from '../icons';
import { fieldsCard, grid, livePill, Page, type Ctx } from './kit';
import { stickMap } from './rc';

const RC_CHANNELS = 65;

export class FailsafePage extends Page {
  constructor(ctx: Ctx) {
    super(ctx, 'Failsafe', 'What the vehicle does when it loses radio, battery, ground station or navigation.', 'failsafe');
  }

  onShow() { void this.ctx.vehicle.setMessageRate(RC_CHANNELS, 5); }
  onHide() { void this.ctx.vehicle.setMessageRate(RC_CHANNELS, 0); }

  protected build(): (Node | null | false)[] {
    const c = this.ctx;
    return [
      this.summary(),
      grid(
        fieldsCard(c, 'Radio', 'radio', 'Triggers when the receiver loses the transmitter. Set your receiver to output low throttle (or nothing) on signal loss.', [
          'FS_THR_ENABLE', 'THR_FAILSAFE', { name: c.pick('FS_THR_VALUE', 'THR_FS_VALUE') ?? 'FS_THR_VALUE', extra: this.throttleLive() },
          'FS_SHORT_ACTN', 'FS_SHORT_TIMEOUT', 'FS_LONG_ACTN', 'FS_LONG_TIMEOUT', 'FS_ACTION', 'FS_TIMEOUT', 'RC_FS_TIMEOUT',
        ]),
        fieldsCard(c, 'Battery', 'battery', 'Two stages: low, then critical. Each can trigger on voltage, remaining capacity, or both.', [
          { name: 'BATT_FS_LOW_ACT', extra: this.battLive() }, 'BATT_LOW_VOLT', 'BATT_LOW_MAH', 'BATT_FS_CRT_ACT', 'BATT_CRT_VOLT', 'BATT_CRT_MAH', 'BATT_FS_VOLTSRC', 'BATT_LOW_TIMER',
        ]),
        fieldsCard(c, 'Ground station', 'cable', 'Triggers when telemetry heartbeats from the ground station stop.', ['FS_GCS_ENABLE', 'FS_GCS_ENABL', 'FS_GCS_TIMEOUT']),
        fieldsCard(c, 'Navigation (EKF)', 'ekfOk', 'Triggers when the position estimate becomes unreliable.', ['FS_EKF_ACTION', 'FS_EKF_THRESH', 'FS_EKF_FILT', 'FS_DR_ENABLE', 'FS_DR_TIMEOUT']),
        fieldsCard(c, 'Geofence', 'frame', 'Keeps the vehicle inside an altitude and distance limit around home.', ['FENCE_ENABLE', 'FENCE_TYPE', 'FENCE_ACTION', 'FENCE_ALT_MAX', 'FENCE_RADIUS', 'FENCE_MARGIN', 'FENCE_AUTOENABLE']),
        fieldsCard(c, 'Other', 'warn', null, ['FS_CRASH_CHECK', 'FS_VIBE_ENABLE', 'FS_OPTIONS']),
      ),
    ];
  }

  /** One chip per failsafe saying what it's set to do. */
  private summary(): HTMLElement {
    const c = this.ctx;
    const items: [string, string][] = [
      ['Radio', c.pick('FS_THR_ENABLE', 'THR_FAILSAFE') ?? ''],
      ['Battery low', 'BATT_FS_LOW_ACT'],
      ['Battery critical', 'BATT_FS_CRT_ACT'],
      ['Ground station', c.pick('FS_GCS_ENABLE', 'FS_GCS_ENABL') ?? ''],
      ['EKF', 'FS_EKF_ACTION'],
      ['Geofence', 'FENCE_ENABLE'],
    ].filter(([, p]) => p && c.has(p)) as [string, string][];
    const row = h('div', { class: 'fs-summary' });
    c.watch(() => {
      row.replaceChildren(...items.map(([label, p]) => {
        const v = c.value(p) ?? 0;
        const text = c.m(p)?.v?.[formatValue(v)] ?? (v ? 'On' : 'Off');
        const off = v === 0;
        return h('span', { class: `fs-chip${off ? ' is-off' : ''}${c.staging.isPending(p) ? ' is-pending' : ''}` },
          icon(off ? 'close' : 'check', 14), h('strong', null, label), h('span', null, text));
      }));
    });
    return row;
  }

  private throttleLive(): HTMLElement {
    const c = this.ctx;
    const live = livePill();
    c.live((s) => {
      const ch = stickMap(c).throttle;
      const pwm = s.rc[ch - 1] ?? 0;
      const thr = c.value(c.pick('FS_THR_VALUE', 'THR_FS_VALUE') ?? '') ?? 0;
      if (!pwm) { live.set('No RC input', 'bad'); return; }
      live.set(`Throttle now ${pwm} µs · failsafe below ${formatValue(thr)}`, pwm <= thr ? 'bad' : pwm - thr < 30 ? 'warn' : 'ok');
    });
    return live.el;
  }

  private battLive(): HTMLElement {
    const c = this.ctx;
    const live = livePill();
    c.live((s) => {
      if (s.batteryVoltage <= 0) { live.set('No battery reading'); return; }
      const low = c.value('BATT_LOW_VOLT') ?? 0, crt = c.value('BATT_CRT_VOLT') ?? 0;
      const lvl = crt && s.batteryVoltage <= crt ? 'bad' : low && s.batteryVoltage <= low ? 'warn' : 'ok';
      live.set(`Battery now ${s.batteryVoltage.toFixed(2)} V${s.batteryRemaining >= 0 ? ` · ${s.batteryRemaining}%` : ''}`, lvl);
    });
    return live.el;
  }
}
