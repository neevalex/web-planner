// Battery: monitors per instance, live readout, voltage/current calibration, pack and sensor presets.
import { formatValue } from '../../vehicle/params';
import { clear, h, storage } from '../dom';
import { icon } from '../icons';
import { toast } from '../toast';
import { confirmDialog, modal } from '../dialog';
import { card, field, fieldsCard, grid, Page, type Ctx } from './kit';

const BATTERY_STATUS = 147;

/** Per-cell starting points. Users should adjust to their packs and flying style. */
const CHEMISTRY: Record<string, { label: string; full: number; arm: number; low: number; crit: number; motMin: number; nominal: number }> = {
  lipo: { label: 'LiPo', full: 4.2, arm: 3.8, low: 3.6, crit: 3.5, motMin: 3.3, nominal: 3.7 },
  lihv: { label: 'LiPo HV', full: 4.35, arm: 3.85, low: 3.6, crit: 3.5, motMin: 3.3, nominal: 3.8 },
  liion: { label: 'Li-ion', full: 4.2, arm: 3.5, low: 3.2, crit: 3.0, motMin: 2.8, nominal: 3.6 },
  life: { label: 'LiFePO4', full: 3.6, arm: 3.2, low: 3.0, crit: 2.9, motMin: 2.8, nominal: 3.2 },
};

/** Analog power modules with published scale factors. Always verify with calibration. */
const SENSORS: { name: string; mult: number; amp: number; note: string }[] = [
  { name: '3DR Power Module', mult: 10.1, amp: 17.0, note: 'Classic 3DR / APM-style module' },
  { name: 'Holybro PM02 / PM06 (analog)', mult: 18.182, amp: 36.364, note: 'Analog versions only — PM02D/PM03D are digital (I2C)' },
];

interface PackPreset { name: string; chem: string; cells: number; capacity: number }

const r2 = (x: number) => Math.round(x * 100) / 100;

export class BatteryPage extends Page {
  private inst = 0;
  private pack: PackPreset = storage.get('battery.pack', { name: '', chem: 'lipo', cells: 4, capacity: 1500 });

  constructor(ctx: Ctx) {
    super(ctx, 'Battery', 'Battery monitors, calibration against a meter, and pack presets.', 'battery');
  }

  onShow() { void this.ctx.vehicle.setMessageRate(BATTERY_STATUS, 4); }
  onHide() { void this.ctx.vehicle.setMessageRate(BATTERY_STATUS, 0); }

  /** Param prefixes of the monitors this firmware has: BATT, BATT2 … BATT9. */
  private instances(): string[] {
    return ['BATT', ...Array.from({ length: 8 }, (_, i) => `BATT${i + 2}`)].filter((p) => this.ctx.has(`${p}_MONITOR`));
  }

  protected build(): (Node | null | false)[] {
    const c = this.ctx;
    const insts = this.instances();
    if (!insts.length) return [h('div', { class: 'page-empty' }, icon('info', 26), h('h3', null, 'No battery monitor parameters'), h('p', null, 'This firmware doesn’t expose battery monitoring.'))];
    if (this.inst >= insts.length) this.inst = 0;
    const p = insts[this.inst];
    const enabled = (c.param(`${p}_MONITOR`)?.value ?? 0) !== 0;

    // Tabs for monitors in use, plus the first unused one to add another battery.
    const on = (ip: string) => (c.value(`${ip}_MONITOR`) ?? 0) !== 0;
    const firstOff = insts.findIndex((ip, i) => i > 0 && !on(ip));
    const shown = insts.map((_, i) => i).filter((i) => i === 0 || on(insts[i]) || i === firstOff || i === this.inst);
    const tabs = insts.length > 1 ? h('div', { class: 'segmented segmented-sm battery-tabs', role: 'tablist' }, shown.map((i) =>
      h('button', { type: 'button', class: 'seg', role: 'tab', 'aria-selected': String(i === this.inst), onclick: () => { this.inst = i; this.rebuild(); } },
        on(insts[i]) || i === 0 ? `Battery ${i + 1}` : [icon('plus', 14), ` Battery ${i + 1}`]))) : null;

    return [
      tabs,
      grid(this.liveCard(p), this.monitorCard(p, enabled)),
      enabled ? grid(this.calibrationCard(p), this.packCard(p)) : null,
      enabled ? grid(
        fieldsCard(c, 'Thresholds', 'warn', 'Arming and failsafe limits for this battery. Actions are on the Failsafe page.', [
          `${p}_ARM_VOLT`, `${p}_ARM_MAH`, `${p}_LOW_VOLT`, `${p}_LOW_MAH`, `${p}_CRT_VOLT`, `${p}_CRT_MAH`, `${p}_FS_LOW_ACT`, `${p}_FS_CRT_ACT`, `${p}_LOW_TIMER`, `${p}_FS_VOLTSRC`,
        ]),
        this.sensorCard(p),
      ) : null,
    ];
  }

  // ---------- live ----------

  private liveCard(p: string): HTMLElement {
    const c = this.ctx;
    const id = this.instances().indexOf(p);
    const big = h('div', { class: 'batt-big' });
    const gauge = h('div', { class: 'batt-gauge' });
    const cells = h('div', { class: 'batt-cells' });
    c.live((s) => {
      const b = s.batteries[id] ?? (id === 0 && s.batteryVoltage > 0
        ? { voltage: s.batteryVoltage, current: s.batteryCurrent, consumed: -1, remaining: s.batteryRemaining, cells: [], temperature: null, time: 0 } : null);
      if (!b || b.voltage <= 0) {
        clear(big, h('p', { class: 'batt-none' }, (c.param(`${p}_MONITOR`)?.value ?? 0) ? 'No reading yet — check wiring and pins, then reboot after changing the monitor type.' : 'Monitor disabled. Choose a monitor type and reboot.'));
        clear(gauge); clear(cells);
        return;
      }
      const n = this.cellCount(b.voltage, b.cells.length);
      clear(big,
        stat('Voltage', `${b.voltage.toFixed(2)}`, 'V'),
        stat('Current', b.current >= 0 ? b.current.toFixed(1) : '—', 'A'),
        stat('Used', b.consumed >= 0 ? String(Math.round(b.consumed)) : '—', 'mAh'),
        stat('Remaining', b.remaining >= 0 ? String(b.remaining) : '—', '%'),
        stat(b.cells.length ? 'Lowest cell' : `Per cell (${n}S est.)`, b.cells.length ? Math.min(...b.cells).toFixed(2) : (b.voltage / n).toFixed(2), 'V'),
        b.temperature !== null ? stat('Temp', b.temperature.toFixed(0), '°C') : null);
      // Gauge from motor-min to full, with the configured thresholds marked.
      const chem = CHEMISTRY[this.pack.chem] ?? CHEMISTRY.lipo;
      const lo = n * chem.motMin, hi = n * chem.full;
      const at = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
      const mark = (name: string, label: string) => {
        const v = c.value(`${p}_${name}`) ?? 0;
        return v > 0 ? h('span', { class: `batt-mark batt-mark-${name.toLowerCase()}`, style: `left:${at(v)}`, title: `${label} ${formatValue(v)} V` }, h('span', null, label)) : null;
      };
      const lvl = (c.value(`${p}_CRT_VOLT`) ?? 0) > 0 && b.voltage <= (c.value(`${p}_CRT_VOLT`) ?? 0) ? 'bad' : (c.value(`${p}_LOW_VOLT`) ?? 0) > 0 && b.voltage <= (c.value(`${p}_LOW_VOLT`) ?? 0) ? 'warn' : 'ok';
      clear(gauge,
        h('div', { class: 'batt-gauge-track' }, h('span', { class: 'batt-gauge-fill', style: `width:${at(b.voltage)}`, dataset: { level: lvl } }),
          mark('CRT_VOLT', 'crit'), mark('LOW_VOLT', 'low'), mark('ARM_VOLT', 'arm')),
        h('div', { class: 'batt-gauge-scale' }, h('span', null, `${lo.toFixed(1)} V`), h('span', null, `${n}S ${chem.label}`), h('span', null, `${hi.toFixed(1)} V`)));
      clear(cells, b.cells.map((v, i) => h('span', { class: 'batt-cell', title: `Cell ${i + 1}: ${v.toFixed(3)} V` }, h('span', { style: `height:${Math.max(4, Math.min(100, ((v - chem.motMin) / (chem.full - chem.motMin)) * 100))}%` }), h('em', null, v.toFixed(2)))));
    });
    return card('Live', 'activity', null, big, gauge, cells);
  }

  /** Cells from the reported cell list, else the fewest cells that fit under a full charge. */
  private cellCount(v: number, reported: number): number {
    if (reported > 1) return reported;
    const chem = CHEMISTRY[this.pack.chem] ?? CHEMISTRY.lipo;
    return Math.max(1, Math.ceil(v / (chem.full + 0.05)));
  }

  // ---------- monitor ----------

  private monitorCard(p: string, enabled: boolean): HTMLElement | null {
    return fieldsCard(this.ctx, 'Monitor', 'battery', enabled ? 'Sensor type and wiring. Type and pin changes apply after a reboot.' : 'Choose the sensor type, write, and reboot — the rest of the settings appear after that.', [
      `${p}_MONITOR`, `${p}_CAPACITY`, `${p}_VOLT_PIN`, `${p}_CURR_PIN`, `${p}_VOLT_MULT`, `${p}_AMP_PERVLT`, `${p}_AMP_OFFSET`, `${p}_VLT_OFFSET`, `${p}_CURR_MULT`, `${p}_I2C_BUS`, `${p}_SERIAL_NUM`,
    ]);
  }

  // ---------- calibration ----------

  private calibrationCard(p: string): HTMLElement {
    const c = this.ctx;
    const id = this.instances().indexOf(p);
    const live = () => {
      const s = c.vehicle.store.state;
      return s.batteries[id] ?? (id === 0 ? { voltage: s.batteryVoltage, current: s.batteryCurrent, consumed: -1 } : null);
    };
    const hasV = c.has(`${p}_VOLT_MULT`), hasA = c.has(`${p}_AMP_PERVLT`);
    if (!hasV && !hasA) {
      return card('Calibration', 'activity', null, h('p', { class: 'muted' }, 'This monitor type has no analog scale factors to calibrate. Digital monitors (DroneCAN, SMBus, INA…) report calibrated values.'));
    }

    const row = (label: string, unit: string, hint: string, compute: (measured: number) => { param: string; from: number; to: number } | string) => {
      const input = h('input', { class: 'num', inputMode: 'decimal', placeholder: 'measured', 'aria-label': label });
      const preview = h('p', { class: 'calrow-preview' });
      const btn = h('button', { class: 'btn btn-small', type: 'button', disabled: true }, icon('check', 16), h('span', null, 'Stage'));
      const update = () => {
        const m = Number(input.value.replace(',', '.'));
        preview.classList.remove('is-result');
        if (!input.value.trim() || !(m > 0)) { preview.textContent = hint; btn.disabled = true; return; }
        const r = compute(m);
        if (typeof r === 'string') { preview.textContent = r; btn.disabled = true; return; }
        preview.classList.add('is-result');
        const pct = ((r.to / r.from - 1) * 100);
        preview.textContent = `${r.param}: ${formatValue(r.from)} → ${formatValue(r.to)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
        btn.disabled = false;
        btn.onclick = async () => {
          if (Math.abs(pct) > 25 && !(await confirmDialog('Large correction', `That changes ${r.param} by ${pct.toFixed(0)}%. Double-check the meter reading and that the right battery is selected.`, 'Stage anyway'))) return;
          c.stage(r.param, r.to);
          toast(`Staged ${r.param} — write it, then check the reading again`, 'ok');
          input.value = ''; update();
        };
      };
      input.addEventListener('input', update);
      c.live(() => { if (input.value) update(); });
      update();
      return h('div', { class: 'calrow' }, h('label', null, label), h('div', { class: 'numwrap' }, input, h('span', { class: 'num-unit' }, unit), btn), preview);
    };

    const volt = hasV ? row('Voltage on your multimeter', 'V', 'Measure the pack at the balance or main lead and enter the reading.', (m) => {
      const b = live();
      if (!b || b.voltage < 1) return 'Waiting for a voltage reading from the vehicle.';
      const mult = c.value(`${p}_VOLT_MULT`) ?? 0;
      return { param: `${p}_VOLT_MULT`, from: mult, to: r4(mult * (m / b.voltage)) };
    }) : null;

    const amps = hasA ? row('Current on a clamp / power meter', 'A', 'Run a steady load (motors at a fixed throttle, props off) and enter the measured current.', (m) => {
      const b = live();
      if (!b || b.current < 0.5) return 'Needs a steady current of at least 0.5 A reported by the vehicle.';
      const per = c.value(`${p}_AMP_PERVLT`) ?? 0;
      return { param: `${p}_AMP_PERVLT`, from: per, to: r4(per * (m / b.current)) };
    }) : null;

    const mah = hasA ? row('mAh your charger put back', 'mAh', 'After a flight, recharge and enter the mAh the charger reports. Works best after a long flight.', (m) => {
      const b = live();
      if (!b || !(b.consumed > 100)) return 'Needs at least 100 mAh consumed this flight (don’t reboot before measuring).';
      const per = c.value(`${p}_AMP_PERVLT`) ?? 0;
      return { param: `${p}_AMP_PERVLT`, from: per, to: r4(per * (m / b.consumed)) };
    }) : null;

    return card('Calibration', 'activity', 'Compare with a trusted meter; the new scale factor is staged for you to write.', volt, amps, mah);
  }

  // ---------- presets ----------

  private packCard(p: string): HTMLElement {
    const c = this.ctx;
    const cls = c.vehicle.store.state.vehicleClass;
    const motPrefix = cls === 'copter' ? 'MOT_' : c.has('Q_M_BAT_VOLT_MAX') ? 'Q_M_' : null;
    const isMotorBattery = Math.round(c.value(`${motPrefix ?? 'MOT_'}BAT_IDX`) ?? 0) === this.instances().indexOf(p);

    const chem = h('select', { 'aria-label': 'Chemistry' }, Object.entries(CHEMISTRY).map(([k, v]) => h('option', { value: k, selected: k === this.pack.chem }, v.label)));
    const cells = h('input', { class: 'num', inputMode: 'numeric', value: String(this.pack.cells), 'aria-label': 'Cells in series' });
    const cap = h('input', { class: 'num', inputMode: 'numeric', value: String(this.pack.capacity), 'aria-label': 'Capacity mAh' });
    const reserves = h('input', { type: 'checkbox', checked: storage.get('battery.reserves', false) });
    const table = h('div', { class: 'preset-table' });
    const saved = h('div', { class: 'preset-saved' });

    const values = (): [string, number, string][] => {
      const ch = CHEMISTRY[chem.value] ?? CHEMISTRY.lipo;
      const n = Math.max(1, Math.min(24, Math.round(Number(cells.value) || 1)));
      const mah = Math.max(0, Math.round(Number(cap.value) || 0));
      const out: [string, number, string][] = [
        [`${p}_CAPACITY`, mah, 'capacity'],
        [`${p}_ARM_VOLT`, r2(n * ch.arm), `${ch.arm.toFixed(2)} V/cell`],
        [`${p}_LOW_VOLT`, r2(n * ch.low), `${ch.low.toFixed(2)} V/cell`],
        [`${p}_CRT_VOLT`, r2(n * ch.crit), `${ch.crit.toFixed(2)} V/cell`],
      ];
      if (reserves.checked && mah) out.push([`${p}_LOW_MAH`, Math.round(mah * 0.2), '20% left'], [`${p}_CRT_MAH`, Math.round(mah * 0.1), '10% left']);
      if (motPrefix && isMotorBattery) out.push([`${motPrefix}BAT_VOLT_MAX`, r2(n * ch.full), 'thrust compensation, full'], [`${motPrefix}BAT_VOLT_MIN`, r2(n * ch.motMin), 'thrust compensation, empty']);
      if (this.instances().indexOf(p) === 0 && c.has('OSD_CELL_COUNT')) out.push(['OSD_CELL_COUNT', n, 'OSD per-cell display']);
      return out.filter(([name]) => c.has(name));
    };
    const render = () => {
      this.pack = { name: this.pack.name, chem: chem.value, cells: Math.round(Number(cells.value) || 1), capacity: Math.round(Number(cap.value) || 0) };
      storage.set('battery.pack', this.pack);
      clear(table, values().map(([name, v, why]) => {
        const cur = c.value(name);
        const same = cur !== undefined && Math.abs(cur - v) < 0.005;
        return h('div', { class: `preset-row${same ? ' is-same' : ''}` },
          h('span', { class: 'mono' }, name), h('span', { class: 'preset-why' }, why),
          h('span', { class: 'mono preset-val' }, same ? formatValue(v) : `${cur === undefined ? '—' : formatValue(cur)} → ${formatValue(v)}`));
      }));
      const list = storage.get<PackPreset[]>('battery.presets', []);
      clear(saved, list.length ? list.map((pp, i) => h('div', { class: 'preset-chip' },
        h('button', { type: 'button', class: 'preset-load', title: 'Load into the form', onclick: () => { chem.value = pp.chem; cells.value = String(pp.cells); cap.value = String(pp.capacity); render(); } },
          h('strong', null, pp.name), h('span', null, `${pp.cells}S ${CHEMISTRY[pp.chem]?.label ?? pp.chem} · ${pp.capacity} mAh`)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete ${pp.name}`, onclick: () => { list.splice(i, 1); storage.set('battery.presets', list); render(); } }, icon('close', 16)),
      )) : h('p', { class: 'muted' }, 'Save packs you fly often to apply them in one tap.'));
    };
    for (const el of [chem, cells, cap]) el.addEventListener('input', render);
    reserves.addEventListener('change', () => { storage.set('battery.reserves', reserves.checked); render(); });
    c.watch(render);

    const apply = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
      const v = values().map(([n, x]): [string, number] => [n, x]);
      c.staging.stageMany(v);
      toast(`Staged ${v.length} values for ${this.pack.cells}S ${CHEMISTRY[this.pack.chem].label}`, 'ok');
    } }, icon('check'), h('span', null, 'Stage preset'));
    const save = h('button', { class: 'btn', type: 'button', onclick: () => {
      const input = h('input', { value: `${this.pack.cells}S ${this.pack.capacity}mAh ${CHEMISTRY[this.pack.chem].label}`, 'aria-label': 'Pack name', style: 'width:100%' });
      const done = () => {
        const name = input.value.trim();
        if (!name) return;
        const list = storage.get<PackPreset[]>('battery.presets', []).filter((x) => x.name !== name);
        list.push({ ...this.pack, name });
        storage.set('battery.presets', list);
        m.close();
        render();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      const m = modal('Save pack', h('div', { class: 'form' }, h('label', null, 'Name'), input), [
        h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: done }, icon('download'), h('span', null, 'Save')),
      ]);
      input.select();
    } }, icon('download'), h('span', null, 'Save pack'));

    return card('Pack presets', 'battery', 'Pick the pack you fly; per-cell voltages are common starting points — adjust them to your packs.',
      h('div', { class: 'preset-form' },
        h('label', null, 'Chemistry', chem),
        h('label', null, 'Cells', h('div', { class: 'numwrap' }, cells, h('span', { class: 'num-unit' }, 'S'))),
        h('label', null, 'Capacity', h('div', { class: 'numwrap' }, cap, h('span', { class: 'num-unit' }, 'mAh')))),
      h('label', { class: 'preset-check' }, reserves, 'Also set capacity failsafes (low at 20%, critical at 10%)'),
      table,
      h('div', { class: 'cal-actions' }, apply, save),
      h('h3', { class: 'card-sub' }, 'My packs'), saved);
  }

  private sensorCard(p: string): HTMLElement | null {
    const c = this.ctx;
    if (!c.has(`${p}_VOLT_MULT`) || !c.has(`${p}_AMP_PERVLT`)) return null;
    return card('Sensor presets', 'cable', 'Published scale factors for common analog power modules. Pins stay at your board’s defaults. Verify with calibration afterwards.',
      h('div', { class: 'sensor-list' }, SENSORS.map((s) =>
        h('div', { class: 'sensor-row' },
          h('div', null, h('strong', null, s.name), h('span', null, `${s.note} · volt ×${s.mult}, ${s.amp} A/V`)),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => {
            c.staging.stageMany([[`${p}_VOLT_MULT`, s.mult], [`${p}_AMP_PERVLT`, s.amp], [`${p}_AMP_OFFSET`, 0]].filter(([n]) => c.has(n as string)) as [string, number][]);
            toast(`Staged ${s.name} scale factors`, 'ok');
          } }, 'Use')))),
      field(c, `${p}_MONITOR`, { label: 'Monitor type', help: false }));
  }
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

function stat(label: string, value: string, unit: string) {
  return h('div', { class: 'batt-stat' }, h('span', { class: 'batt-stat-label' }, label), h('span', { class: 'batt-stat-val' }, value, h('small', null, unit)));
}
