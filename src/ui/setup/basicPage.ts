// Basic setup: frame, board orientation, GPS, battery, accelerometer calibration.
import { MAV_CMD, MAV_RESULT } from '../../mavlink/generated';
import { resultName } from '../../vehicle/vehicle';
import { formatValue } from '../../vehicle/params';
import { clear, h } from '../dom';
import { icon } from '../icons';
import { toast } from '../toast';
import { card, field, fieldsCard, grid, livePill, Page, type Ctx } from './kit';
import { frameDiagram, frameGlyph, layoutFor } from './frames';

const ACCELCAL_POS = 42429; // MAV_CMD_ACCELCAL_VEHICLE_POS
const POS_TEXT: Record<number, [string, string]> = {
  1: ['Level', 'Place the vehicle level on a flat surface.'],
  2: ['Left side', 'Place the vehicle on its LEFT side.'],
  3: ['Right side', 'Place the vehicle on its RIGHT side.'],
  4: ['Nose down', 'Point the nose straight DOWN.'],
  5: ['Nose up', 'Point the nose straight UP.'],
  6: ['Upside down', 'Place the vehicle on its BACK (upside down).'],
};
const POS_SUCCESS = 16777215;
const POS_FAILED = 16777216;

// FRAME_CLASS → arms drawn in the picker glyph.
const GLYPH_ARMS: Record<number, number> = { 1: 4, 2: 6, 3: 8, 4: 4, 5: 3, 6: 1, 7: 3, 8: 1, 9: 1, 10: 2, 11: 2, 12: 6, 13: 4, 14: 10 };
/** Scripting-defined frames are only listed when one is already selected. */
const SCRIPTING_CLASSES = new Set([15, 16, 17]);

export class BasicPage extends Page {
  constructor(ctx: Ctx) {
    super(ctx, 'Basic', 'Frame, board orientation, GPS, battery and accelerometer calibration.', 'wrench');
  }

  protected build(): (Node | null | false)[] {
    const c = this.ctx;
    const cls = c.vehicle.store.state.vehicleClass;
    return [
      cls === 'copter' ? this.copterFrame() : cls === 'plane' ? this.planeFrame() : fieldsCard(c, 'Frame', 'frame', null, ['FRAME_CLASS', 'FRAME_TYPE']),
      grid(
        this.orientationCard(),
        this.accelCard(),
        fieldsCard(c, 'GPS', 'satellite', 'Receiver type and constellations. Changes apply after a reboot.', [
          { name: c.pick('GPS1_TYPE', 'GPS_TYPE') ?? 'GPS_TYPE', extra: this.gpsLive() },
          c.pick('GPS1_GNSS_MODE', 'GPS_GNSS_MODE') ?? '', c.pick('GPS_AUTO_CONFIG') ?? '', c.pick('GPS_AUTO_SWITCH') ?? '',
          c.pick('GPS2_TYPE', 'GPS_TYPE2') ?? '',
        ].filter(Boolean)),
        fieldsCard(c, 'Battery', 'battery', 'Monitor type and pack. Set the monitor first, reboot, then the rest appears.', [
          { name: 'BATT_MONITOR', extra: this.battLive() }, 'BATT_CAPACITY', 'BATT_VOLT_PIN', 'BATT_CURR_PIN', 'BATT_VOLT_MULT', 'BATT_AMP_PERVLT', 'BATT_AMP_OFFSET', 'BATT_ARM_VOLT',
        ]),
        fieldsCard(c, 'Identity', 'info', null, ['SYSID_THISMAV', c.pick('MAV_GCS_SYSID', 'SYSID_MYGCS') ?? '', 'BRD_SAFETY_DEFLT', 'BRD_SAFETYENABLE'].filter(Boolean)),
      ),
    ];
  }

  // ---------- frame ----------

  private copterFrame(): HTMLElement {
    const c = this.ctx;
    const clsMeta = c.m('FRAME_CLASS')?.v ?? {};
    const diagramHost = h('div', { class: 'frame-diagram' });
    const caption = h('p', { class: 'frame-caption' });
    const choices = h('div', { class: 'frame-choices', role: 'radiogroup', 'aria-label': 'Frame class' },
      Object.entries(clsMeta).filter(([v]) => v !== '0' && (!SCRIPTING_CLASSES.has(Number(v)) || Math.round(c.value('FRAME_CLASS') ?? 0) === Number(v))).map(([v, label]) => {
        const n = Number(v);
        const b = h('button', { type: 'button', class: 'frame-choice', role: 'radio', 'aria-checked': 'false', dataset: { v }, onclick: () => c.stage('FRAME_CLASS', n) },
          frameGlyph(GLYPH_ARMS[n] ?? 4), h('span', null, label));
        return b;
      }));
    c.watch(() => {
      const fc = c.value('FRAME_CLASS') ?? 0;
      const ft = c.value('FRAME_TYPE') ?? 0;
      for (const b of choices.querySelectorAll<HTMLButtonElement>('.frame-choice')) {
        const on = Number(b.dataset.v) === fc;
        b.setAttribute('aria-checked', String(on));
        b.classList.toggle('is-pending', on && c.staging.isPending('FRAME_CLASS'));
      }
      const layout = layoutFor(fc, ft);
      clear(diagramHost, layout ? frameDiagram(layout) : h('div', { class: 'frame-nodiagram' }, icon('info', 20), 'No diagram for this frame type yet. Motor numbering follows the ArduPilot docs.'));
      caption.textContent = layout ? `${layout.name}. Letters show motor-test order (clockwise from the nose).` : '';
    });
    return card('Frame', 'frame', 'Choose the frame class, then its type. Both take effect after a reboot.',
      choices,
      h('div', { class: 'frame-row' },
        h('div', { class: 'fields' }, field(c, 'FRAME_CLASS', { kind: 'select', help: false }), field(c, 'FRAME_TYPE')),
        h('div', null, diagramHost, caption)),
    );
  }

  private planeFrame(): HTMLElement | null {
    const c = this.ctx;
    const q = c.value('Q_ENABLE') ?? 0;
    return fieldsCard(c, 'Frame', 'frame', q ? 'QuadPlane is enabled: set the lift motor frame here.' : 'Enable QuadPlane for VTOL frames, then reboot.',
      ['Q_ENABLE', ...(q ? ['Q_FRAME_CLASS', 'Q_FRAME_TYPE', 'Q_TAILSIT_ENABLE', 'Q_TILT_ENABLE'] : [])]);
  }

  // ---------- orientation ----------

  private orientationCard(): HTMLElement | null {
    const c = this.ctx;
    const live = livePill();
    c.live((s) => {
      const d = (r: number) => ((r * 180) / Math.PI).toFixed(0);
      live.set(`roll ${d(s.roll)}°  pitch ${d(s.pitch)}°  heading ${Math.round(s.heading)}°`);
    });
    return fieldsCard(c, 'Board orientation', 'reread', 'If the board isn’t mounted arrow-forward, set its rotation. Tilt the vehicle and check the live attitude follows.', [
      { name: 'AHRS_ORIENTATION', extra: live.el }, 'AHRS_TRIM_X', 'AHRS_TRIM_Y',
    ]);
  }

  private gpsLive(): HTMLElement {
    const live = livePill();
    const FIX = ['no GPS', 'no fix', '2D fix', '3D fix', 'DGPS', 'RTK float', 'RTK fixed'];
    this.ctx.live((s) => live.set(`${FIX[s.gpsFix] ?? s.gpsFix} · ${s.gpsSats} sats · HDOP ${s.gpsHdop.toFixed(1)}`, s.gpsFix >= 3 ? 'ok' : s.gpsFix >= 2 ? 'warn' : 'bad'));
    return live.el;
  }

  private battLive(): HTMLElement {
    const live = livePill();
    this.ctx.live((s) => live.set(s.batteryVoltage > 0
      ? `${s.batteryVoltage.toFixed(2)} V${s.batteryCurrent >= 0 ? ` · ${s.batteryCurrent.toFixed(1)} A` : ''}` : 'no reading', s.batteryVoltage > 0 ? 'ok' : ''));
    return live.el;
  }

  // ---------- accelerometer calibration ----------

  private accelCard(): HTMLElement {
    const v = this.ctx.vehicle;
    const status = h('div', { class: 'cal-status' });
    const stepBtn = h('button', { class: 'btn btn-accent', type: 'button', hidden: true }, icon('check'), h('span', null, 'Done, next position'));
    const startBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('activity'), h('span', null, 'Calibrate accelerometers'));
    const levelBtn = h('button', { class: 'btn', type: 'button' }, icon('reread'), h('span', null, 'Calibrate level'));
    const steps = h('ol', { class: 'cal-steps' }, Object.entries(POS_TEXT).map(([n, [label]]) => h('li', { dataset: { pos: n } }, label)));
    let current = 0;
    let off: (() => void) | null = null;

    const setStatus = (text: string, level: '' | 'ok' | 'bad' | 'warn' = '') => { status.textContent = text; status.dataset.level = level; };
    const markSteps = () => {
      for (const li of steps.querySelectorAll<HTMLElement>('li')) {
        const p = Number(li.dataset.pos);
        li.dataset.state = current === POS_SUCCESS || p < current ? 'done' : p === current ? 'now' : '';
      }
    };
    this.ctx.onReset(() => off?.());
    const finish = () => { off?.(); off = null; stepBtn.hidden = true; startBtn.disabled = false; levelBtn.disabled = false; };

    startBtn.addEventListener('click', async () => {
      if (v.store.state.armed) { toast('Disarm first', 'warn'); return; }
      off?.();
      off = v.on('COMMAND_LONG', (d) => {
        if (d.command !== ACCELCAL_POS) return;
        current = Math.round(d.param1);
        markSteps();
        if (current === POS_SUCCESS) { setStatus('Calibration successful. Offsets are saved.', 'ok'); v.log('Accelerometer calibration successful'); finish(); return; }
        if (current === POS_FAILED) { setStatus('Calibration failed. Try again, holding each position still.', 'bad'); v.log('Accelerometer calibration failed', 3); finish(); return; }
        const t = POS_TEXT[current];
        if (t) { setStatus(t[1]); stepBtn.hidden = false; stepBtn.disabled = false; }
      });
      startBtn.disabled = true; levelBtn.disabled = true;
      current = 0; markSteps();
      setStatus('Starting…');
      const r = await v.command(MAV_CMD.MAV_CMD_PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 1, 0, 0]).catch((e: Error) => { setStatus(e.message, 'bad'); return -1; });
      if (r !== MAV_RESULT.MAV_RESULT_ACCEPTED && r !== -1) { setStatus(`Vehicle refused: ${resultName(r)}`, 'bad'); finish(); }
      if (r === -1) finish();
    });

    stepBtn.addEventListener('click', async () => {
      stepBtn.disabled = true;
      setStatus('Sampling… hold still.');
      // ArduPilot confirms with a COMMAND_LONG for the next position (handled above).
      await v.command(ACCELCAL_POS, [current], { retries: 2 }).catch(() => { setStatus('No reply from the vehicle', 'bad'); stepBtn.disabled = false; });
    });

    levelBtn.addEventListener('click', async () => {
      if (v.store.state.armed) { toast('Disarm first', 'warn'); return; }
      levelBtn.disabled = true;
      setStatus('Calibrating level… keep the vehicle still.');
      const r = await v.command(MAV_CMD.MAV_CMD_PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 2, 0, 0], { timeoutMs: 6000, retries: 1 }).catch(() => -1);
      levelBtn.disabled = false;
      if (r === MAV_RESULT.MAV_RESULT_ACCEPTED) { setStatus('Level calibrated. AHRS trims updated.', 'ok'); v.log('Level calibration done'); }
      else setStatus(r === -1 ? 'No reply from the vehicle' : `Level calibration ${resultName(r)}`, 'bad');
    });

    const offsets = h('p', { class: 'cal-offsets' });
    this.ctx.watch(() => {
      const o = ['INS_ACCOFFS_X', 'INS_ACCOFFS_Y', 'INS_ACCOFFS_Z'].map((n) => this.ctx.param(n)?.value);
      offsets.textContent = o.every((x) => x !== undefined) ? `Current offsets: ${o.map((x) => formatValue(x!)).join(', ')}` : '';
    });

    return card('Accelerometer', 'activity', 'Full calibration walks through six positions. Level calibration only trims the horizon — do it on a flat surface.',
      h('div', { class: 'cal-actions' }, startBtn, levelBtn),
      steps, status, h('div', { class: 'cal-actions' }, stepBtn), offsets);
  }
}
