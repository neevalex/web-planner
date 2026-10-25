// Compass: detected devices, priority, orientation, onboard calibration (MAG_CAL_*).
import { MAV_RESULT } from '../../mavlink/generated';
import { resultName } from '../../vehicle/vehicle';
import { formatValue } from '../../vehicle/params';
import { confirmDialog } from '../dialog';
import { clear, h } from '../dom';
import { icon } from '../icons';
import { toast } from '../toast';
import { card, field, fieldsCard, grid, Page, type Ctx } from './kit';

const START_MAG_CAL = 42424, ACCEPT_MAG_CAL = 42425, CANCEL_MAG_CAL = 42426, FIXED_MAG_CAL_YAW = 42006;

const BUS = ['unknown bus', 'I2C', 'SPI', 'DroneCAN', 'SITL', 'MSP', 'Serial', 'QSPI'];
const DEVTYPE: Record<number, string> = {
  0x01: 'HMC5883', 0x02: 'LSM303D', 0x04: 'AK8963', 0x05: 'BMM150', 0x06: 'LSM9DS1', 0x07: 'HMC5883', 0x08: 'LIS3MDL',
  0x09: 'AK09916', 0x0A: 'IST8310', 0x0B: 'ICM20948', 0x0C: 'MMC3416', 0x0D: 'QMC5883L', 0x0E: 'MAG3110', 0x0F: 'SITL',
  0x10: 'IST8308', 0x11: 'RM3100',
};
const STATUS = ['Not started', 'Waiting to start', 'Step 1 of 2', 'Step 2 of 2', 'Success', 'Failed', 'Bad orientation', 'Bad radius'];

export function describeDevId(id: number): { name: string; where: string } {
  if (!id) return { name: 'Not detected', where: '' };
  const busType = id & 7, bus = (id >> 3) & 31, addr = (id >> 8) & 0xff, devtype = (id >> 16) & 0xff;
  if (busType === 3) return { name: `DroneCAN compass`, where: `node ${addr}, sensor ${devtype}` };
  const name = DEVTYPE[devtype] ?? `type 0x${devtype.toString(16)}`;
  return { name, where: `${BUS[busType] ?? 'bus ' + busType} ${bus}, addr 0x${addr.toString(16).padStart(2, '0')}` };
}

/** Param names for compass slot i (1-based), which ArduPilot spells inconsistently. */
function names(i: number) {
  const n = i === 1 ? '' : String(i);
  return {
    devId: `COMPASS_DEV_ID${n}`,
    use: `COMPASS_USE${n}`,
    ext: i === 1 ? 'COMPASS_EXTERNAL' : `COMPASS_EXTERN${n}`,
    orient: `COMPASS_ORIENT${n}`,
    ofs: [`COMPASS_OFS${n}_X`, `COMPASS_OFS${n}_Y`, `COMPASS_OFS${n}_Z`],
  };
}

interface CalState { pct: number; status: number; attempt: number; mask: number[]; fitness?: number; ofs?: [number, number, number]; autosaved?: boolean }

export class CompassPage extends Page {
  private cal = new Map<number, CalState>();
  private running = false;

  constructor(ctx: Ctx) {
    super(ctx, 'Compass', 'Detected compasses, priority and orientation, and onboard calibration.', 'compass');
  }

  protected build(): (Node | null | false)[] {
    const c = this.ctx;
    return [
      this.devicesCard(),
      grid(
        this.calCard(),
        fieldsCard(c, 'General', 'compass', null, ['COMPASS_ENABLE', 'COMPASS_AUTODEC', 'COMPASS_DEC', 'COMPASS_LEARN', 'COMPASS_AUTO_ROT', 'COMPASS_CAL_FIT', 'COMPASS_OPTIONS', 'COMPASS_TYPEMASK']),
      ),
    ];
  }

  // ---------- devices & priority ----------

  private devicesCard(): HTMLElement {
    const c = this.ctx;
    const prio = [1, 2, 3].map((i) => `COMPASS_PRIO${i}_ID`).filter((n) => c.has(n));
    const list = h('div', { class: 'mag-list' });

    const render = () => {
      const slots = [1, 2, 3].filter((i) => c.has(names(i).devId));
      // Order rows by priority when the firmware has priorities; extra detected sensors follow.
      const prioIds = prio.map((p) => Math.round(c.value(p) ?? 0));
      const slotOfId = (id: number) => slots.find((i) => Math.round(c.param(names(i).devId)!.value) === id);
      const ordered: number[] = [];
      for (const id of prioIds) { const s = id ? slotOfId(id) : undefined; if (s && !ordered.includes(s)) ordered.push(s); }
      for (const s of slots) if (!ordered.includes(s)) ordered.push(s);

      clear(list, ordered.map((slot, idx) => {
        const n = names(slot);
        const id = Math.round(c.param(n.devId)!.value);
        const d = describeDevId(id);
        const inPrio = prio.length > 0 && idx < prio.length && prioIds.includes(id);
        const move = (dir: -1 | 1) => {
          const ids = [...prioIds];
          const j = idx + dir;
          if (j < 0 || j >= ids.length) return;
          [ids[idx], ids[j]] = [ids[j], ids[idx]];
          c.staging.stageMany(prio.map((p, k): [string, number] => [p, ids[k]]));
        };
        const ofs = n.ofs.map((o) => c.param(o)?.value);
        return h('div', { class: `mag-row${id ? '' : ' is-missing'}` },
          h('div', { class: 'mag-rank' }, inPrio ? String(idx + 1) : '–'),
          h('div', { class: 'mag-id' },
            h('strong', null, d.name),
            h('span', null, [d.where, c.value(n.ext) ? 'external' : 'internal'].filter(Boolean).join(' · ')),
            ofs.every((x) => x !== undefined) ? h('span', { class: 'mag-ofs' }, `offsets ${ofs.map((x) => formatValue(x!)).join(', ')}`) : null),
          h('div', { class: 'mag-fields' }, field(c, n.use, { label: 'Use', help: false }), field(c, n.orient, { label: 'Orientation', help: false })),
          inPrio ? h('div', { class: 'mag-move' },
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Higher priority', disabled: idx === 0, onclick: () => move(-1) }, icon('up')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Lower priority', disabled: idx >= prio.length - 1 || !prioIds[idx + 1], onclick: () => move(1) }, icon('down'))) : h('div'));
      }));
      c.refresh();
    };
    let lastKey = '';
    c.watch(() => {
      const key = prio.map((p) => c.value(p)).join(',');
      if (key !== lastKey) { lastKey = key; render(); }
    });
    return card('Compasses', 'compass', 'The first compass is the one ArduPilot flies on. Use the arrows to change priority; external compasses usually belong first.', list);
  }

  // ---------- calibration ----------

  private calCard(): HTMLElement {
    const c = this.ctx;
    const v = c.vehicle;
    const progress = h('div', { class: 'magcal' });
    const startBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('activity'), h('span', null, 'Start calibration'));
    const cancelBtn = h('button', { class: 'btn', type: 'button', hidden: true }, icon('close'), h('span', null, 'Cancel'));
    const acceptBtn = h('button', { class: 'btn btn-accent', type: 'button', hidden: true }, icon('check'), h('span', null, 'Accept'));
    const note = h('p', { class: 'cal-status' });

    const render = () => {
      startBtn.hidden = this.running;
      cancelBtn.hidden = !this.running;
      const states = [...this.cal.entries()].sort((a, b) => a[0] - b[0]);
      acceptBtn.hidden = !states.some(([, s]) => s.status === 4 && !s.autosaved);
      clear(progress, states.map(([id, s]) => {
        const done = s.status >= 4;
        const level = s.status === 4 ? 'ok' : s.status >= 5 ? 'bad' : '';
        return h('div', { class: 'magcal-row', dataset: { level } },
          h('div', { class: 'magcal-head' },
            h('strong', null, `Compass ${id + 1}`),
            h('span', null, done ? STATUS[s.status] : `${STATUS[s.status] ?? ''} · ${s.pct}%${s.attempt > 1 ? ` · attempt ${s.attempt}` : ''}`)),
          h('div', { class: 'magcal-bar' }, h('span', { style: `width:${done && s.status === 4 ? 100 : s.pct}%` })),
          coverage(s.mask),
          s.fitness !== undefined ? h('p', { class: 'magcal-result' },
            `Fitness ${s.fitness.toFixed(1)} (lower is better)`,
            s.ofs ? ` · offsets ${s.ofs.map((x) => Math.round(x)).join(', ')}` : '') : null);
      }));
    };

    c.onMsg('MAG_CAL_PROGRESS', (d) => {
      const prev = this.cal.get(d.compass_id);
      this.cal.set(d.compass_id, { ...prev, pct: d.completion_pct, status: d.cal_status, attempt: d.attempt, mask: d.completion_mask });
      this.running = true;
      render();
    });
    c.onMsg('MAG_CAL_REPORT', (d) => {
      const prev = this.cal.get(d.compass_id) ?? { pct: 100, attempt: 1, mask: [] };
      this.cal.set(d.compass_id, { ...prev, status: d.cal_status, fitness: d.fitness, ofs: [d.ofs_x, d.ofs_y, d.ofs_z], autosaved: !!d.autosaved, pct: 100 });
      const all = [...this.cal.values()];
      if (all.every((s) => s.status >= 4)) {
        this.running = false;
        const ok = all.every((s) => s.status === 4);
        note.textContent = ok ? 'Calibration finished and saved. Reboot the flight controller to use the new offsets.' : 'Some compasses failed. Check for metal or wiring near the compass and try again.';
        note.dataset.level = ok ? 'ok' : 'bad';
        v.log(ok ? 'Compass calibration successful' : 'Compass calibration failed', ok ? 6 : 3);
        if (ok) c.staging.requireReboot('compass calibration');
      }
      render();
    });

    startBtn.addEventListener('click', async () => {
      if (v.store.state.armed) { toast('Disarm first', 'warn'); return; }
      this.cal.clear();
      note.textContent = 'Rotate the vehicle slowly through every orientation — each face pointing down at least once — until both steps finish.';
      note.dataset.level = '';
      const r = await v.command(START_MAG_CAL, [0, 0, 1, 0, 0]).catch(() => -1);
      if (r === MAV_RESULT.MAV_RESULT_ACCEPTED) { this.running = true; v.log('Compass calibration started'); }
      else { note.textContent = r === -1 ? 'No reply from the vehicle' : `Vehicle refused: ${resultName(r)}`; note.dataset.level = 'bad'; }
      render();
    });
    cancelBtn.addEventListener('click', async () => {
      await v.command(CANCEL_MAG_CAL, [0]).catch(() => -1);
      this.running = false; this.cal.clear();
      note.textContent = 'Calibration cancelled.'; note.dataset.level = '';
      v.log('Compass calibration cancelled', 4);
      render();
    });
    acceptBtn.addEventListener('click', async () => {
      const r = await v.command(ACCEPT_MAG_CAL, [0]).catch(() => -1);
      toast(r === MAV_RESULT.MAV_RESULT_ACCEPTED ? 'Calibration accepted' : 'Accept failed', r === MAV_RESULT.MAV_RESULT_ACCEPTED ? 'ok' : 'error');
    });
    c.onReset(() => { if (this.running) void v.command(CANCEL_MAG_CAL, [0]).catch(() => {}); this.running = false; });

    // Quick calibration from a known heading (large vehicles that can't be rotated).
    const yaw = h('input', { class: 'num', inputMode: 'decimal', placeholder: '0–359', 'aria-label': 'True heading in degrees' });
    const quick = h('div', { class: 'quickcal' },
      h('span', null, 'Large vehicle: point it at a known true heading and enter it.'),
      h('div', { class: 'numwrap' }, yaw, h('span', { class: 'num-unit' }, '°'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
          const deg = Number(yaw.value);
          if (!(deg >= 0 && deg < 360)) { toast('Enter a heading from 0 to 359', 'warn'); return; }
          if (v.store.state.gpsFix < 3 && !(await confirmDialog('No 3D GPS fix', 'This method needs a GPS position to look up the magnetic field. Try anyway?', 'Try'))) return;
          const r = await v.command(FIXED_MAG_CAL_YAW, [deg, 0, 0, 0]).catch(() => -1);
          toast(r === MAV_RESULT.MAV_RESULT_ACCEPTED ? 'Compass calibrated from heading — reboot to apply' : `Heading calibration ${r === -1 ? 'got no reply' : resultName(r)}`, r === MAV_RESULT.MAV_RESULT_ACCEPTED ? 'ok' : 'error');
          if (r === MAV_RESULT.MAV_RESULT_ACCEPTED) c.staging.requireReboot('compass calibration');
        } }, 'Calibrate')));

    render();
    return card('Calibration', 'activity', 'Runs on the flight controller for all compasses at once. Results save automatically.',
      h('div', { class: 'cal-actions' }, startBtn, cancelBtn, acceptBtn), note, progress, quick);
  }
}

/** 80-section sphere coverage from MAG_CAL_PROGRESS.completion_mask, as a 10×8 grid. */
function coverage(mask: number[]): HTMLElement {
  const cells: HTMLElement[] = [];
  for (let i = 0; i < 80; i++) cells.push(h('span', { class: (mask[i >> 3] ?? 0) & (1 << (i & 7)) ? 'on' : '' }));
  return h('div', { class: 'magcal-cov', title: 'Orientations covered so far' }, cells);
}
