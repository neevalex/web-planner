// Channels: flight-mode switch and slots, and aux functions (RCx_OPTION) for every channel.
import { formatValue } from '../../vehicle/params';
import { modal } from '../dialog';
import { h } from '../dom';
import { icon } from '../icons';
import { card, field, grid, livePill, Page, type Ctx } from './kit';
import { optionName, rcOptions, roleOf, stickMap, switchPos } from './rc';

const RC_CHANNELS = 65;
const SLOT_EDGES = [1230, 1360, 1490, 1620, 1749];
const SLOT_TEXT = ['≤ 1230', '1231 – 1360', '1361 – 1490', '1491 – 1620', '1621 – 1749', '≥ 1750'];

/** ArduPilot's 6-position mode switch decoding. */
const slotOf = (pwm: number) => (pwm ? SLOT_EDGES.findIndex((e) => pwm <= e) : -1);

export class ChannelsPage extends Page {
  constructor(ctx: Ctx) {
    super(ctx, 'Channels', 'Flight mode switch and what each auxiliary channel does.', 'channels');
  }

  onShow() { void this.ctx.vehicle.setMessageRate(RC_CHANNELS, 10); }
  onHide() { void this.ctx.vehicle.setMessageRate(RC_CHANNELS, 0); }

  protected build(): (Node | null | false)[] {
    return [grid(this.modesCard(), this.auxCard())];
  }

  private modeNames() {
    const c = this.ctx;
    const chParam = c.pick('FLTMODE_CH', 'MODE_CH');
    const slots = [1, 2, 3, 4, 5, 6].map((i) => c.pick(`FLTMODE${i}`, `MODE${i}`)).filter(Boolean) as string[];
    return { chParam, slots };
  }

  // ---------- flight modes ----------

  private modesCard(): HTMLElement | null {
    const c = this.ctx;
    const { chParam, slots } = this.modeNames();
    if (!chParam || !slots.length) return null;
    const simple = c.has('SIMPLE') ? 'SIMPLE' : null;
    const superSimple = c.has('SUPER_SIMPLE') ? 'SUPER_SIMPLE' : null;

    const live = livePill();
    const rows = slots.map((name, i) => {
      const flags = [simple, superSimple].filter(Boolean).map((p) => {
        const mask = 2 ** i;
        const b = h('button', { type: 'button', class: 'chipbtn chipbtn-sm', 'aria-pressed': 'false', title: p === 'SIMPLE' ? 'Simple mode in this slot' : 'Super Simple mode in this slot', onclick: () => {
          const cur = c.value(p!) ?? 0;
          c.stage(p!, Math.floor(cur / mask) % 2 ? cur - mask : cur + mask);
        } }, p === 'SIMPLE' ? 'Simple' : 'Super simple');
        c.watch(() => {
          b.setAttribute('aria-pressed', String(Math.floor((c.value(p!) ?? 0) / mask) % 2 === 1));
          b.classList.toggle('is-pending', c.staging.isPending(p!));
        });
        return b;
      });
      const sel = h('select', { 'aria-label': `Flight mode ${i + 1}`, onchange: () => c.stage(name, Number(sel.value)) },
        Object.entries(c.m(name)?.v ?? {}).map(([v, l]) => h('option', { value: v }, l)));
      const row = h('div', { class: 'fm-row' },
        h('span', { class: 'fm-slot' }, String(i + 1)),
        h('span', { class: 'fm-pwm' }, SLOT_TEXT[i]),
        sel,
        flags.length ? h('div', { class: 'fm-flags' }, flags) : null);
      c.watch(() => {
        const v = formatValue(c.value(name) ?? 0);
        if (document.activeElement !== sel) sel.value = v;
        row.classList.toggle('is-pending', c.staging.isPending(name));
      });
      return row;
    });

    c.live((s) => {
      const ch = Math.round(c.value(chParam) ?? 0);
      const pwm = ch > 0 ? s.rc[ch - 1] ?? 0 : 0;
      const slot = slotOf(pwm);
      rows.forEach((r, i) => r.classList.toggle('is-live', i === slot));
      live.set(ch ? (pwm ? `Channel ${ch}: ${pwm} µs → slot ${slot + 1} · vehicle in ${s.modeName}` : `Channel ${ch}: no signal`) : 'Mode switch disabled', pwm ? 'ok' : 'warn');
    });

    return card('Flight modes', 'gauge', 'Flip your mode switch: the highlighted slot follows it.',
      h('div', { class: 'fields' }, field(c, chParam, { label: 'Mode channel', extra: live.el })),
      h('div', { class: 'fm-list' }, rows));
  }

  // ---------- aux functions ----------

  private auxCard(): HTMLElement {
    const c = this.ctx;
    const { chParam } = this.modeNames();
    const list = h('div', { class: 'aux-list' });
    const rows: { ch: number; pos: HTMLElement; bar: HTMLElement; pwm: HTMLElement }[] = [];
    for (let ch = 1; ch <= 16; ch++) {
      const p = `RC${ch}_OPTION`;
      if (!c.has(p)) continue;
      const pos = h('span', { class: 'aux-pos' });
      const bar = h('span', { class: 'aux-bar-fill' });
      const pwm = h('span', { class: 'aux-pwm' });
      const n = ch;
      const btn = h('button', { type: 'button', class: 'aux-fn', onclick: () => this.pickFunction(n) }, h('span', { class: 'aux-fn-text' }), icon('down', 16));
      const row = h('div', { class: 'aux-row' },
        h('span', { class: 'aux-ch' }, `CH${ch}`),
        h('span', { class: 'aux-bar' }, bar), pwm, pos, btn);
      c.watch(() => {
        const map = stickMap(c);
        const role = roleOf(map, n);
        const modeCh = chParam ? Math.round(c.value(chParam) ?? 0) : 0;
        const fn = c.value(p) ?? 0;
        const text = btn.querySelector('.aux-fn-text')!;
        if (role && !fn) { text.textContent = `${role} stick`; btn.classList.add('is-role'); }
        else if (n === modeCh && !fn) { text.textContent = 'Flight mode switch'; btn.classList.add('is-role'); }
        else { text.textContent = fn ? optionName(c, fn) : 'Do nothing'; btn.classList.remove('is-role'); }
        btn.classList.toggle('is-unset', !fn && !role && n !== modeCh);
        row.classList.toggle('is-pending', c.staging.isPending(p));
      });
      list.append(row);
      rows.push({ ch, pos, bar, pwm });
    }
    c.live((s) => {
      for (const r of rows) {
        const v = s.rc[r.ch - 1] ?? 0;
        r.pwm.textContent = v ? String(v) : '—';
        r.bar.style.width = v ? `${Math.max(0, Math.min(100, ((v - 900) / 1200) * 100))}%` : '0';
        const sp = switchPos(v);
        r.pos.textContent = sp ? sp[0].toUpperCase() + sp.slice(1) : '';
        r.pos.dataset.pos = sp ?? '';
      }
    });
    return card('Auxiliary functions', 'channels', 'Pick what each channel does. Low / Mid / High shows how ArduPilot reads the switch right now.', list);
  }

  private pickFunction(ch: number) {
    const c = this.ctx;
    const p = `RC${ch}_OPTION`;
    const current = c.value(p) ?? 0;
    const options = Object.entries(rcOptions(c)).map(([v, label]) => ({ v: Number(v), label }));
    const used = new Map<number, number>();
    for (let i = 1; i <= 16; i++) if (i !== ch) { const f = c.value(`RC${i}_OPTION`) ?? 0; if (f) used.set(f, i); }

    const search = h('input', { type: 'search', class: 'picker-search', placeholder: 'Search functions', 'aria-label': 'Search functions', autocomplete: 'off' });
    const list = h('div', { class: 'picker-list', role: 'listbox' });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren(...options
        .filter((o) => !q || o.label.toLowerCase().includes(q) || String(o.v) === q)
        .map((o) => h('button', { type: 'button', class: 'picker-item', role: 'option', 'aria-selected': String(o.v === current), onclick: () => { c.stage(p, o.v); m.close(); } },
          h('span', { class: 'picker-label' }, o.label),
          used.has(o.v) ? h('span', { class: 'picker-note' }, `also on CH${used.get(o.v)}`) : null,
          h('span', { class: 'picker-code' }, String(o.v)))));
    };
    search.addEventListener('input', render);
    render();
    const m = modal(`Channel ${ch} function`, h('div', { class: 'picker' }, search, list));
    search.focus();
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }
}
