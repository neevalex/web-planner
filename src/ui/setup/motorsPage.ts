// Motors: layout with output mapping, motor test, motor/ESC settings, layout examples.
import { MAV_CMD, MAV_RESULT } from '../../mavlink/generated';
import { resultName } from '../../vehicle/vehicle';
import { confirmDialog } from '../dialog';
import { clear, h, storage } from '../dom';
import { icon } from '../icons';
import { toast } from '../toast';
import { card, fieldsCard, grid, Page, type Ctx } from './kit';
import { frameDiagram, layoutFor, motorCount, type Layout } from './frames';

const SERVO_OUTPUT_RAW = 36;
/** SERVOn_FUNCTION values for Motor1..12. */
const MOTOR_FN = [33, 34, 35, 36, 37, 38, 39, 40, 82, 83, 84, 85];

export class MotorsPage extends Page {
  private throttle = storage.get('motors.throttle', 5);
  private duration = storage.get('motors.duration', 2);
  private confirmed = false;
  private active: number | null = null;

  constructor(ctx: Ctx) {
    super(ctx, 'Motors', 'Motor order and spin direction, motor test, and ESC settings.', 'motors');
  }

  onShow() { void this.ctx.vehicle.setMessageRate(SERVO_OUTPUT_RAW, 10); }
  onHide() { void this.ctx.vehicle.setMessageRate(SERVO_OUTPUT_RAW, 0); }

  /** Q_ prefix on QuadPlanes, none on copters; null when there are no lift motors. */
  private prefix(): string | null {
    const c = this.ctx;
    const cls = c.vehicle.store.state.vehicleClass;
    if (cls === 'copter') return '';
    if (cls === 'plane' && (c.param('Q_ENABLE')?.value ?? 0) > 0 && c.has('Q_FRAME_CLASS')) return 'Q_';
    return null;
  }

  protected build(): (Node | null | false)[] {
    const c = this.ctx;
    const pre = this.prefix();
    if (pre === null) {
      return [h('div', { class: 'page-empty' }, icon('info', 26), h('h3', null, 'No lift motors on this vehicle'),
        h('p', null, 'Motor test and layouts apply to multicopters and QuadPlanes. Throttle and servo outputs are under Parameters → Servo outputs.'))];
    }
    const mot = pre ? 'Q_M_' : 'MOT_';
    return [
      grid(this.layoutCard(pre), this.testCard(pre)),
      grid(
        fieldsCard(c, 'Motor output', 'motors', 'Protocol and the throttle curve. Spin-arm must be below spin-min.', [
          `${mot}PWM_TYPE`, `${mot}PWM_MIN`, `${mot}PWM_MAX`, `${mot}SPIN_ARM`, `${mot}SPIN_MIN`, `${mot}SPIN_MAX`, `${mot}THST_EXPO`, `${mot}THST_HOVER`, `${mot}HOVER_LEARN`, `${mot}SPOOL_TIME`,
        ]),
        fieldsCard(c, 'Battery compensation', 'battery', null, [`${mot}BAT_VOLT_MAX`, `${mot}BAT_VOLT_MIN`, `${mot}BAT_CURR_MAX`, `${mot}BAT_IDX`]),
        fieldsCard(c, 'ESC (DShot / BLHeli)', 'cable', 'DShot rate, telemetry and pass-through. Changes apply after a reboot.', [
          'SERVO_DSHOT_ESC', 'SERVO_DSHOT_RATE', 'SERVO_BLH_MASK', 'SERVO_BLH_AUTO', 'SERVO_BLH_OTYPE', 'SERVO_BLH_POLES', 'SERVO_BLH_TRATE', 'SERVO_BLH_3DMASK',
        ]),
      ),
      this.examplesCard(),
    ];
  }

  private layout(pre: string): Layout | null {
    const fc = Math.round(this.ctx.param(`${pre}FRAME_CLASS`)?.value ?? 0);
    const ft = Math.round(this.ctx.param(`${pre}FRAME_TYPE`)?.value ?? 0);
    return layoutFor(fc, ft);
  }

  /** Motor number → output channel, from SERVOn_FUNCTION. */
  private outputs(): Map<number, number> {
    const out = new Map<number, number>();
    for (let ch = 1; ch <= 32; ch++) {
      const f = Math.round(this.ctx.param(`SERVO${ch}_FUNCTION`)?.value ?? -1);
      const m = MOTOR_FN.indexOf(f);
      if (m >= 0 && !out.has(m + 1)) out.set(m + 1, ch);
    }
    return out;
  }

  // ---------- layout ----------

  private layoutCard(pre: string): HTMLElement {
    const c = this.ctx;
    const host = h('div', { class: 'frame-diagram frame-diagram-lg' });
    const caption = h('p', { class: 'frame-caption' });
    const table = h('div', { class: 'motor-table' });
    const render = () => {
      const layout = this.layout(pre);
      const outs = this.outputs();
      if (!layout) {
        clear(host, h('div', { class: 'frame-nodiagram' }, icon('info', 20), 'No diagram for this frame type yet. Use the test buttons — they run motors in ArduPilot’s A, B, C… order.'));
        caption.textContent = '';
      } else {
        clear(host, frameDiagram(layout, { outputs: outs, active: this.active, onMotor: (n) => void this.testMotor(pre, layout.order.get(n)!.charCodeAt(0) - 64, n) }));
        caption.textContent = `${layout.name}. Tap a motor to spin it. Letters are the motor-test order.`;
      }
      const rv = c.has('SERVO_BLH_RVMASK') && (c.param(`${pre ? 'Q_M_' : 'MOT_'}PWM_TYPE`)?.value ?? 0) >= 4;
      const count = layout?.motors.length ?? motorCount(Math.round(c.param(`${pre}FRAME_CLASS`)?.value ?? 1));
      clear(table, Array.from({ length: count }, (_, i) => {
        const n = i + 1;
        const out = outs.get(n);
        const m = layout?.motors.find((x) => x.n === n);
        const bit = out ? 2 ** (out - 1) : 0;
        return h('div', { class: 'motor-row', dataset: { motor: String(n) } },
          h('span', { class: 'motor-n' }, `M${n}`),
          h('span', { class: 'motor-letter' }, layout?.order.get(n) ?? String.fromCharCode(64 + n)),
          h('span', { class: 'motor-out' }, out ? `OUT${out}` : 'not assigned'),
          h('span', { class: 'motor-dir' }, m ? (m.cw ? 'CW' : 'CCW') : ''),
          h('span', { class: 'motor-pwm' }, h('span', { class: 'motor-pwm-fill' }), h('span', { class: 'motor-pwm-val' }, '—')),
          rv && out ? h('button', { type: 'button', class: 'chipbtn chipbtn-sm', 'aria-pressed': String(Math.floor((c.value('SERVO_BLH_RVMASK') ?? 0) / bit) % 2 === 1), title: 'Reverse spin direction (DShot)', onclick: () => {
            const cur = c.value('SERVO_BLH_RVMASK') ?? 0;
            c.stage('SERVO_BLH_RVMASK', Math.floor(cur / bit) % 2 ? cur - bit : cur + bit);
          } }, 'Reverse') : h('span'));
      }));
    };
    let key = '';
    c.watch(() => {
      const k = [`${pre}FRAME_CLASS`, `${pre}FRAME_TYPE`, 'SERVO_BLH_RVMASK', ...Array.from({ length: 16 }, (_, i) => `SERVO${i + 1}_FUNCTION`)].map((n) => c.value(n)).join(',') + `|${this.active}`;
      if (k !== key) { key = k; render(); }
    });
    this.rerenderLayout = () => { key = ''; c.refresh(); };
    c.live((s) => {
      const outs = this.outputs();
      for (const row of table.querySelectorAll<HTMLElement>('.motor-row')) {
        const out = outs.get(Number(row.dataset.motor));
        const pwm = out ? s.servo[out - 1] ?? 0 : 0;
        (row.querySelector('.motor-pwm-val') as HTMLElement).textContent = pwm ? String(pwm) : '—';
        (row.querySelector('.motor-pwm-fill') as HTMLElement).style.width = pwm ? `${Math.max(0, Math.min(100, ((pwm - 1000) / 1000) * 100))}%` : '0';
      }
    });
    const staged = c.staging.isPending(`${pre}FRAME_CLASS`) || c.staging.isPending(`${pre}FRAME_TYPE`);
    return card('Layout', 'frame', staged ? 'You have an unwritten frame change: write it and reboot before testing motors.' : 'Check each motor spins in the direction shown — swap two motor wires (or use Reverse with DShot) if not.', host, caption, table);
  }
  private rerenderLayout = () => {};

  // ---------- test ----------

  private testCard(pre: string): HTMLElement {
    const c = this.ctx;
    const thr = h('input', { class: 'num', inputMode: 'decimal', value: String(this.throttle), 'aria-label': 'Throttle percent' });
    const dur = h('input', { class: 'num', inputMode: 'decimal', value: String(this.duration), 'aria-label': 'Duration in seconds' });
    thr.addEventListener('change', () => { this.throttle = Math.max(0, Math.min(100, Number(thr.value) || 0)); thr.value = String(this.throttle); storage.set('motors.throttle', this.throttle); });
    dur.addEventListener('change', () => { this.duration = Math.max(0.5, Math.min(10, Number(dur.value) || 2)); dur.value = String(this.duration); storage.set('motors.duration', this.duration); });
    const buttons = h('div', { class: 'motor-buttons' });
    const render = () => {
      const layout = this.layout(pre);
      const count = layout?.motors.length ?? motorCount(Math.round(c.param(`${pre}FRAME_CLASS`)?.value ?? 1));
      const byLetter = layout ? [...layout.order].sort((a, b) => a[1].localeCompare(b[1])) : Array.from({ length: count }, (_, i): [number, string] => [i + 1, String.fromCharCode(65 + i)]);
      clear(buttons, byLetter.map(([n, letter], i) =>
        h('button', { class: 'btn motor-btn', type: 'button', onclick: () => void this.testMotor(pre, i + 1, layout ? n : null) },
          h('strong', null, letter), h('span', null, layout ? `Motor ${n}` : `Output ${letter}`))));
    };
    c.watch(render);
    return card('Motor test', 'activity', 'Spins one motor at a time at low throttle.',
      h('div', { class: 'warnbox' }, icon('warn', 18), h('span', null, h('strong', null, 'Remove the propellers. '), 'The motor spins as soon as you press the button. The vehicle must be disarmed.')),
      h('div', { class: 'test-settings' },
        h('label', null, 'Throttle', h('div', { class: 'numwrap' }, thr, h('span', { class: 'num-unit' }, '%'))),
        h('label', null, 'Duration', h('div', { class: 'numwrap' }, dur, h('span', { class: 'num-unit' }, 's')))),
      buttons,
      h('div', { class: 'cal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => void this.testAll(pre) }, icon('activity'), h('span', null, 'Test all in sequence')),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => void this.stopAll() }, icon('close'), h('span', null, 'Stop'))));
  }

  private async preflight(): Promise<boolean> {
    const v = this.ctx.vehicle;
    if (!v.connected) { toast('Not connected', 'warn'); return false; }
    if (v.store.state.armed) { toast('Disarm before testing motors', 'warn'); return false; }
    if (!this.confirmed) {
      this.confirmed = await confirmDialog('Propellers removed?', 'Motor test spins motors immediately. Make sure all propellers are off and nothing can touch the motors.', 'Props are off', true);
    }
    return this.confirmed;
  }

  /** seq: 1-based motor-test sequence number (A = 1). */
  private async testMotor(_pre: string, seq: number, motorNumber: number | null) {
    if (!(await this.preflight())) return;
    const v = this.ctx.vehicle;
    this.active = motorNumber;
    this.rerenderLayout();
    const r = await v.command(MAV_CMD.MAV_CMD_DO_MOTOR_TEST, [seq, 0, this.throttle, this.duration, 0, 0]).catch(() => -1);
    if (r !== MAV_RESULT.MAV_RESULT_ACCEPTED) toast(r === -1 ? 'No reply to motor test' : `Motor test ${resultName(r)} — see the console`, 'error');
    else v.log(`Motor test ${String.fromCharCode(64 + seq)}${motorNumber ? ` (motor ${motorNumber})` : ''} at ${this.throttle}% for ${this.duration}s`);
    setTimeout(() => { this.active = null; this.rerenderLayout(); }, this.duration * 1000);
  }

  private async testAll(pre: string) {
    if (!(await this.preflight())) return;
    const layout = this.layout(pre);
    const count = layout?.motors.length ?? motorCount(Math.round(this.ctx.param(`${pre}FRAME_CLASS`)?.value ?? 1));
    const r = await this.ctx.vehicle.command(MAV_CMD.MAV_CMD_DO_MOTOR_TEST, [1, 0, this.throttle, this.duration, count, 0]).catch(() => -1);
    if (r !== MAV_RESULT.MAV_RESULT_ACCEPTED) toast(r === -1 ? 'No reply to motor test' : `Motor test ${resultName(r)}`, 'error');
    else this.ctx.vehicle.log(`Motor test: all ${count} motors in sequence`);
  }

  private async stopAll() {
    await this.ctx.vehicle.command(MAV_CMD.MAV_CMD_DO_MOTOR_TEST, [1, 0, 0, 0.1, 0, 0], { retries: 2 }).catch(() => -1);
    this.active = null; this.rerenderLayout();
  }

  // ---------- examples ----------

  private examplesCard(): HTMLElement {
    const ex: [number, number][] = [[1, 1], [1, 0], [1, 12], [2, 1], [2, 0], [3, 1]];
    return card('Common layouts', 'frame', 'ArduPilot motor numbering and spin directions for frequently used frames. Arrows show propeller rotation seen from above.',
      h('div', { class: 'examples' }, ex.map(([fc, ft]) => {
        const l = layoutFor(fc, ft)!;
        return h('figure', { class: 'example' }, frameDiagram(l), h('figcaption', null, l.name));
      })));
  }
}
