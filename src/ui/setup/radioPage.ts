// Remote control: stick visualisation, every channel live, radio calibration.
import { clear, h, storage } from '../dom';
import { icon } from '../icons';
import { toast } from '../toast';
import { card, fieldsCard, grid, Page, type Ctx } from './kit';
import { chanRange, normalize, optionName, roleOf, stickMap } from './rc';
import { svg } from './svg';

const RC_CHANNELS = 65;

interface Cal { min: number[]; max: number[] }

export class RadioPage extends Page {
  private mode = storage.get<1 | 2>('radio.mode', 2);
  private cal: Cal | null = null;
  private renderCal: () => void = () => {};

  constructor(ctx: Ctx) {
    super(ctx, 'Radio', 'Live stick and channel positions from your receiver, and radio calibration.', 'radio');
  }

  onShow() { void this.ctx.vehicle.setMessageRate(RC_CHANNELS, 20); }
  onHide() { void this.ctx.vehicle.setMessageRate(RC_CHANNELS, 0); }

  protected build(): (Node | null | false)[] {
    const c = this.ctx;
    return [
      grid(this.sticksCard(), this.calCard()),
      this.channelsCard(),
      grid(
        fieldsCard(c, 'Receiver', 'radio', 'Serial receiver protocol and RSSI source.', ['RC_PROTOCOLS', 'RC_OPTIONS', 'RSSI_TYPE', 'RSSI_CHANNEL', 'RC_SPEED']),
        fieldsCard(c, 'Stick mapping', 'cable', 'Which input channel carries each stick. Defaults are 1–4 (AETR).', ['RCMAP_ROLL', 'RCMAP_PITCH', 'RCMAP_THROTTLE', 'RCMAP_YAW']),
      ),
    ];
  }

  // ---------- sticks ----------

  private sticksCard(): HTMLElement {
    const c = this.ctx;
    const left = gimbal('Left stick');
    const right = gimbal('Right stick');
    const modeBtn = (m: 1 | 2) => h('button', { type: 'button', class: 'seg', 'aria-selected': String(this.mode === m), onclick: () => {
      this.mode = m; storage.set('radio.mode', m);
      for (const b of seg.querySelectorAll('.seg')) b.setAttribute('aria-selected', String(b.textContent === `Mode ${m}`));
    } }, `Mode ${m}`);
    const seg = h('div', { class: 'segmented segmented-sm' }, modeBtn(1), modeBtn(2));
    const rssi = h('span', { class: 'live' }, h('span', { class: 'live-dot' }), h('span', { class: 'live-text' }));

    c.live((s) => {
      const map = stickMap(c);
      const val = (ch: number, fromMin = false) => normalize(s.rc[ch - 1] ?? 0, chanRange(c, ch), fromMin);
      const thr = val(map.throttle, true) * 2 - 1;
      const yaw = val(map.yaw), roll = val(map.roll);
      // ArduPilot convention: pitch stick forward = low PWM, shown as "up" here.
      const pitch = -val(map.pitch);
      if (this.mode === 2) { left.set(yaw, thr); right.set(roll, pitch); } else { left.set(yaw, pitch); right.set(roll, thr); }
      left.label(this.mode === 2 ? 'Yaw · Throttle' : 'Yaw · Pitch');
      right.label(this.mode === 2 ? 'Roll · Pitch' : 'Roll · Throttle');
      const has = s.rc.some((x) => x > 0);
      (rssi.querySelector('.live-text') as HTMLElement).textContent = !has ? 'No RC input' : s.rssi === 255 ? `${s.rcCount} channels` : `${s.rcCount} channels · RSSI ${Math.round((s.rssi / 254) * 100)}%`;
      rssi.dataset.level = has ? 'ok' : 'bad';
    });

    return card('Sticks', 'radio', null,
      h('div', { class: 'sticks-head' }, rssi, seg),
      h('div', { class: 'sticks' }, left.el, right.el));
  }

  // ---------- channels ----------

  private channelsCard(): HTMLElement {
    const c = this.ctx;
    const list = h('div', { class: 'chbars' });
    const rows: { ch: number; fill: HTMLElement; val: HTMLElement; marks: HTMLElement; name: HTMLElement; rev: HTMLButtonElement; calMin: HTMLElement; calMax: HTMLElement }[] = [];
    for (let ch = 1; ch <= 16; ch++) {
      if (!c.has(`RC${ch}_MIN`)) continue;
      const fill = h('span', { class: 'chbar-fill' });
      const marks = h('span', { class: 'chbar-marks' });
      const calMin = h('span', { class: 'chbar-cal chbar-cal-min' });
      const calMax = h('span', { class: 'chbar-cal chbar-cal-max' });
      const val = h('span', { class: 'chbar-val' });
      const name = h('span', { class: 'chbar-name' });
      const n = ch;
      const rev = h('button', { type: 'button', class: 'chipbtn chipbtn-sm', 'aria-pressed': 'false', title: 'Reverse this channel', onclick: () => {
        c.stage(`RC${n}_REVERSED`, (c.value(`RC${n}_REVERSED`) ?? 0) ? 0 : 1);
      } }, 'Rev');
      list.append(h('div', { class: 'chbar' },
        h('span', { class: 'chbar-ch' }, String(ch)), name,
        h('span', { class: 'chbar-track' }, fill, marks, calMin, calMax),
        val, c.has(`RC${ch}_REVERSED`) ? rev : h('span', null)));
      rows.push({ ch, fill, val, marks, name, rev, calMin, calMax });
    }

    const pos = (pwm: number) => `${Math.max(0, Math.min(100, ((pwm - 800) / 1400) * 100))}%`;
    c.watch(() => {
      const map = stickMap(c);
      for (const r of rows) {
        const range = chanRange(c, r.ch);
        const role = roleOf(map, r.ch);
        const fn = c.value(`RC${r.ch}_OPTION`) ?? 0;
        r.name.textContent = role ?? (fn ? optionName(c, fn) : '—');
        r.name.classList.toggle('is-role', !!role);
        r.marks.style.setProperty('--min', pos(range.min));
        r.marks.style.setProperty('--max', pos(range.max));
        r.marks.style.setProperty('--trim', pos(range.trim));
        r.rev.setAttribute('aria-pressed', String(range.rev));
        r.rev.classList.toggle('is-pending', c.staging.isPending(`RC${r.ch}_REVERSED`));
      }
    });
    c.live((s) => {
      for (const r of rows) {
        const pwm = s.rc[r.ch - 1] ?? 0;
        r.val.textContent = pwm ? String(pwm) : '—';
        r.fill.style.width = pwm ? pos(pwm) : '0';
        if (this.cal && pwm) {
          this.cal.min[r.ch] = Math.min(this.cal.min[r.ch] ?? pwm, pwm);
          this.cal.max[r.ch] = Math.max(this.cal.max[r.ch] ?? pwm, pwm);
        }
        r.calMin.hidden = r.calMax.hidden = !this.cal;
        if (this.cal && this.cal.min[r.ch]) {
          r.calMin.style.left = pos(this.cal.min[r.ch]);
          r.calMax.style.left = pos(this.cal.max[r.ch]);
        }
      }
    });
    return card('Channels', 'channels', 'Grey ticks mark the calibrated min, trim and max. Function names come from the Channels page.', list);
  }

  // ---------- calibration ----------

  private calCard(): HTMLElement {
    const c = this.ctx;
    const body = h('div', { class: 'cal-body' });
    const render = () => {
      if (!this.cal) {
        clear(body,
          h('ol', { class: 'cal-howto' },
            h('li', null, 'Props off. Transmitter on, receiver bound — the sticks above should move.'),
            h('li', null, 'Press Start, then move every stick and switch to both ends, several times.'),
            h('li', null, 'Center the sticks, throttle down, and press Finish. The new ranges are staged for you to review and write.')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
            if (!c.vehicle.store.state.rc.some((x) => x > 0)) { toast('No RC input — check the receiver', 'warn'); return; }
            this.cal = { min: [], max: [] }; render();
          } }, icon('activity'), h('span', null, 'Start calibration')));
      } else {
        clear(body,
          h('p', { class: 'cal-live' }, icon('activity', 16), 'Recording… move all sticks and switches to their ends. Amber ticks show the range captured so far.'),
          h('div', { class: 'cal-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => { this.cal = null; render(); } }, icon('close'), h('span', null, 'Cancel')),
            h('button', { class: 'btn btn-accent', type: 'button', onclick: () => this.finishCal() }, icon('check'), h('span', null, 'Finish'))));
      }
    };
    render();
    this.ctx.onReset(() => { this.cal = null; });
    this.renderCal = render;
    return card('Calibration', 'activity', 'Teaches ArduPilot the real end points of each channel.', body);
  }

  private finishCal() {
    const c = this.ctx;
    const cal = this.cal!;
    const rc = c.vehicle.store.state.rc;
    const map = stickMap(c);
    const changes: [string, number][] = [];
    const skipped: number[] = [];
    for (let ch = 1; ch <= 16; ch++) {
      const lo = cal.min[ch], hi = cal.max[ch];
      if (!lo || !hi || !c.has(`RC${ch}_MIN`)) continue;
      if (hi - lo < 200) { if (ch <= 4) skipped.push(ch); continue; } // not moved
      if (lo < 800 || hi > 2200) { skipped.push(ch); continue; }
      const now = rc[ch - 1] || Math.round((lo + hi) / 2);
      const trim = ch === map.throttle ? lo : [map.roll, map.pitch, map.yaw].includes(ch) ? now : Math.round((lo + hi) / 2);
      changes.push([`RC${ch}_MIN`, lo], [`RC${ch}_MAX`, hi], [`RC${ch}_TRIM`, Math.max(lo, Math.min(hi, trim))]);
    }
    this.cal = null;
    this.renderCal();
    if (!changes.length) { toast('No channel moved far enough — nothing changed', 'warn'); return; }
    c.staging.stageMany(changes);
    const n = changes.length / 3;
    toast(`Staged new ranges for ${n} channel${n === 1 ? '' : 's'} — review and write`, 'ok');
    if (skipped.length) toast(`Channel${skipped.length > 1 ? 's' : ''} ${skipped.join(', ')} not calibrated: not moved fully or out of range`, 'warn');
  }
}

function gimbal(title: string) {
  const S = 160;
  const dot = svg('circle', { r: 11, cx: S / 2, cy: S / 2, class: 'gimbal-dot' });
  const trail = svg('line', { x1: S / 2, y1: S / 2, x2: S / 2, y2: S / 2, class: 'gimbal-line' });
  const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'gimbal', role: 'img', 'aria-label': title });
  root.append(
    svg('rect', { x: 4, y: 4, width: S - 8, height: S - 8, rx: 22, class: 'gimbal-box' }),
    svg('line', { x1: S / 2, y1: 14, x2: S / 2, y2: S - 14, class: 'gimbal-cross' }),
    svg('line', { x1: 14, y1: S / 2, x2: S - 14, y2: S / 2, class: 'gimbal-cross' }),
    trail, dot);
  const caption = h('span', { class: 'gimbal-caption' });
  const values = h('span', { class: 'gimbal-values' });
  const el = h('figure', { class: 'gimbal-wrap' }, root, h('figcaption', null, caption, values));
  return {
    el,
    set(x: number, y: number) {
      const px = S / 2 + x * (S / 2 - 18), py = S / 2 - y * (S / 2 - 18);
      dot.setAttribute('cx', String(px)); dot.setAttribute('cy', String(py));
      trail.setAttribute('x2', String(px)); trail.setAttribute('y2', String(py));
      values.textContent = `${Math.round(x * 100)} / ${Math.round(y * 100)}`;
    },
    label(t: string) { caption.textContent = t; },
  };
}
