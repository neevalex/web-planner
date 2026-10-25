// Building blocks for setup pages: a shared context, parameter-bound fields and cards.
// Fields edit through the shared Staging store, so changes join the same write tray.
import { formatValue, isIntType, type Param } from '../../vehicle/params';
import { prettyUnit, type ParamMeta } from '../../vehicle/paramMeta';
import type { Vehicle } from '../../vehicle/vehicle';
import type { VehicleState } from '../../vehicle/state';
import type { MessageMap, MessageName } from '../../mavlink/generated';
import type { MetaStore } from '../meta';
import type { Staging } from '../staging';
import { clear, h } from '../dom';
import { icon, type IconName } from '../icons';
import { openConnectDialog } from '../connect';

export class Ctx {
  private updaters = new Set<() => void>();
  private subs: (() => unknown)[] = [];

  constructor(readonly vehicle: Vehicle, readonly staging: Staging, readonly meta: MetaStore) {
    staging.onChange(() => this.refresh());
    vehicle.params.onChange(() => this.refresh());
  }

  has(name: string) { return this.vehicle.params.params.has(name); }
  param(name: string): Param | undefined { return this.vehicle.params.get(name); }
  value(name: string): number | undefined { return this.staging.value(name); }
  m(name: string): ParamMeta | undefined { return this.meta.get(name); }
  stage(name: string, v: number) { this.staging.stage(name, v); }

  /** Registers a function that re-syncs some UI from current values. Cleared on page rebuild. */
  watch(fn: () => void) { this.updaters.add(fn); fn(); return fn; }
  resetWatchers() {
    this.updaters.clear();
    for (const u of this.subs) u();
    this.subs = [];
  }

  /** The page element; live readouts pause while it isn't on screen. */
  root: HTMLElement | null = null;

  /** Subscribe to vehicle state for the lifetime of the current page build (only while visible). */
  live(fn: (s: VehicleState) => void) {
    this.subs.push(this.vehicle.store.subscribe((s) => { if (!this.root || this.root.isConnected) fn(s); }));
  }

  /** Listen for a MAVLink message for the lifetime of the current page build. */
  onMsg<N extends MessageName>(name: N, fn: (d: MessageMap[N]) => void) { this.subs.push(this.vehicle.on(name, fn)); }

  /** Clean-up to run when the page is rebuilt. */
  onReset(fn: () => unknown) { this.subs.push(fn); }
  refresh() { for (const fn of this.updaters) fn(); }

  /** First of several names this vehicle actually has (firmware renames, vehicle differences). */
  pick(...names: string[]): string | undefined { return names.find((n) => this.has(n)); }
}

// ---------- page frame ----------

export abstract class Page {
  readonly el: HTMLElement;
  protected body = h('div', { class: 'page-body' });
  private builtFor = '';
  private ready = false;

  constructor(protected ctx: Ctx, readonly title: string, readonly lead: string, readonly ic: IconName) {
    this.el = h('section', { class: 'view page', 'aria-label': title },
      h('header', { class: 'page-head' },
        h('div', { class: 'page-title' }, icon(ic, 22), h('h1', null, title)),
        h('p', { class: 'page-lead' }, lead)),
      this.body);
    ctx.root = this.el;
    const rebuild = () => this.maybeBuild();
    ctx.vehicle.params.onUpdate(rebuild);
    ctx.meta.onLoad(() => { this.builtFor = ''; this.maybeBuild(); });
    ctx.vehicle.store.subscribe(rebuild);
    // Subclass fields aren't initialised until our constructor returns, so build afterwards.
    queueMicrotask(() => { this.ready = true; this.maybeBuild(); });
  }

  private maybeBuild() {
    if (!this.ready) return;
    const pm = this.ctx.vehicle.params;
    const s = this.ctx.vehicle.store.state;
    const key = pm.progress.done && pm.params.size ? `${s.vehicleClass}:${pm.params.size}:${this.ctx.meta.loaded}` : `none:${s.link}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    if (!pm.progress.done || !pm.params.size) {
      clear(this.body, notReady(this.ctx, this.title));
      return;
    }
    this.ctx.resetWatchers();
    clear(this.body, this.build());
    this.ctx.refresh();
  }

  /** Rebuild on demand (e.g. after a structural change like a new frame type). */
  protected rebuild() { this.builtFor = ''; this.maybeBuild(); }

  protected abstract build(): (Node | null | false)[];
  onShow(): void {}
  onHide(): void {}
}

function notReady(ctx: Ctx, title: string): HTMLElement {
  const s = ctx.vehicle.store.state;
  if (s.link === 'disconnected') {
    return h('div', { class: 'page-empty' },
      icon('plug', 28),
      h('h3', null, `Connect to set up ${title.toLowerCase()}`),
      h('p', null, 'These settings are read from the flight controller.'),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn btn-accent', type: 'button', onclick: () => openConnectDialog(ctx.vehicle, 'usb') }, icon('usb'), h('span', null, 'Connect with USB')),
        h('button', { class: 'btn', type: 'button', onclick: () => openConnectDialog(ctx.vehicle, 'net') }, icon('network'), h('span', null, 'Network'))));
  }
  return h('div', { class: 'page-empty' }, h('div', { class: 'spinner' }), h('h3', null, 'Reading parameters…'));
}

// ---------- cards ----------

export function card(title: string, ic: IconName | null, lead: string | null, ...children: (Node | null | false)[]): HTMLElement {
  return h('section', { class: 'card' },
    h('header', { class: 'card-head' }, ic ? icon(ic, 18) : null, h('h2', null, title)),
    lead ? h('p', { class: 'card-lead' }, lead) : null,
    ...children.filter(Boolean) as Node[]);
}

/** A card of fields for whichever of `names` exist. Returns null when none do. */
export function fieldsCard(ctx: Ctx, title: string, ic: IconName | null, lead: string | null, names: (string | FieldSpec)[]): HTMLElement | null {
  const rows = names.map((n) => (typeof n === 'string' ? field(ctx, n) : field(ctx, n.name, n))).filter(Boolean) as HTMLElement[];
  if (!rows.length) return null;
  return card(title, ic, lead, h('div', { class: 'fields' }, rows));
}

export const grid = (...cards: (Node | null | false)[]) => h('div', { class: 'cards' }, cards.filter(Boolean) as Node[]);

// ---------- fields ----------

export interface FieldSpec {
  name: string;
  label?: string;
  help?: string | false;
  /** Force a control kind; default picks from the metadata. */
  kind?: 'switch' | 'select' | 'number' | 'bits';
  /** Extra element shown under the control (e.g. a live reading). */
  extra?: Node;
}

/** One labelled control bound to a parameter. Null when the vehicle doesn't have it. */
export function field(ctx: Ctx, name: string, spec: Partial<FieldSpec> = {}): HTMLElement | null {
  const p = ctx.param(name);
  if (!p) return null;
  const m = ctx.m(name);
  const kind = spec.kind ?? autoKind(p, m);
  const label = spec.label ?? m?.n ?? name;
  const help = spec.help === false ? null : spec.help ?? firstSentence(m?.d);
  const control = makeControl(ctx, p, m, kind);
  const row = h('div', { class: `frow frow-${kind}` },
    h('div', { class: 'frow-label' },
      h('label', { class: 'frow-name', htmlFor: `f-${name}` }, label, m?.rb ? h('span', { class: 'frow-tag', title: 'Takes effect after a reboot' }, icon('power', 12), 'reboot') : null),
      h('span', { class: 'frow-code' }, name),
      help ? h('p', { class: 'frow-help', title: m?.d ?? '' }, help) : null),
    h('div', { class: 'frow-control' }, control.el, spec.extra ?? null));
  ctx.watch(() => {
    row.classList.toggle('is-pending', ctx.staging.isPending(name));
    control.sync();
  });
  return row;
}

function autoKind(p: Param, m?: ParamMeta): FieldSpec['kind'] {
  if (m?.b) return 'bits';
  if (m?.v && !m.r && isIntType(p.type)) {
    const keys = Object.keys(m.v);
    if (keys.length === 2 && keys.includes('0') && keys.includes('1')) return 'switch';
    return 'select';
  }
  return 'number';
}

export function firstSentence(d?: string): string | null {
  if (!d) return null;
  const s = d.match(/^.*?[.!?](\s|$)/)?.[0] ?? d;
  return s.length > 180 ? s.slice(0, 177) + '…' : s.trim();
}

interface Control { el: HTMLElement; sync(): void }

function makeControl(ctx: Ctx, p: Param, m: ParamMeta | undefined, kind: FieldSpec['kind']): Control {
  const name = p.name;
  const id = `f-${name}`;
  const ro = !!m?.ro;

  if (kind === 'switch') {
    const input = h('input', { type: 'checkbox', id, role: 'switch', disabled: ro, onchange: () => ctx.stage(name, input.checked ? 1 : 0) });
    const el = h('label', { class: 'switch' }, input, h('span', { class: 'switch-track' }), h('span', { class: 'switch-text' }));
    return { el, sync: () => {
      const v = ctx.value(name) ?? 0;
      input.checked = v !== 0;
      el.querySelector('.switch-text')!.textContent = m?.v?.[formatValue(v, p.type)] ?? (v ? 'On' : 'Off');
    } };
  }

  if (kind === 'select') {
    const sel = h('select', { id, disabled: ro, onchange: () => ctx.stage(name, Number(sel.value)) },
      Object.entries(m?.v ?? {}).map(([v, label]) => h('option', { value: v }, label)));
    return { el: sel, sync: () => {
      const key = formatValue(ctx.value(name) ?? 0, p.type);
      if (!sel.querySelector(`option[value="${CSS.escape(key)}"]`)) {
        sel.querySelector('option[data-custom]')?.remove();
        sel.append(h('option', { value: key, dataset: { custom: '1' } }, `${key} (custom)`));
      }
      if (document.activeElement !== sel) sel.value = key;
    } };
  }

  if (kind === 'bits') {
    const chips = Object.entries(m?.b ?? {}).map(([bit, label]) => {
      const mask = 2 ** Number(bit);
      const b = h('button', { type: 'button', class: 'chipbtn', 'aria-pressed': 'false', disabled: ro, title: `bit ${bit}`, onclick: () => {
        const cur = ctx.value(name) ?? 0;
        const on = Math.floor(cur / mask) % 2 === 1;
        ctx.stage(name, on ? cur - mask : cur + mask);
      } }, icon('check', 13), label);
      return { b, mask };
    });
    const valueText = h('span', { class: 'bits-value' });
    const el = h('div', { class: 'bits' }, chips.map((c) => c.b), valueText);
    return { el, sync: () => {
      const v = ctx.value(name) ?? 0;
      for (const c of chips) c.b.setAttribute('aria-pressed', String(Math.floor(v / c.mask) % 2 === 1));
      valueText.textContent = `= ${formatValue(v, p.type)}`;
    } };
  }

  // number (+ presets when docs suggest values)
  const input = h('input', { id, class: 'num', inputMode: isIntType(p.type) ? 'numeric' : 'decimal', spellcheck: false, autocomplete: 'off', readOnly: ro });
  input.addEventListener('input', () => {
    const v = input.value.trim() === '' ? NaN : Number(input.value.replace(',', '.'));
    ctx.stage(name, v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { ctx.staging.unstage(name); input.blur(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !ro) {
      e.preventDefault();
      const step = m?.i ?? (isIntType(p.type) ? 1 : 0.01);
      const base = Number(input.value);
      if (!Number.isFinite(base)) return;
      const next = Number((base + (e.key === 'ArrowUp' ? step : -step)).toPrecision(7));
      input.value = formatValue(next, p.type);
      ctx.stage(name, next);
    }
  });
  input.addEventListener('blur', () => ctx.refresh());
  const unit = h('span', { class: 'num-unit' }, prettyUnit(m?.u));
  const range = m?.r ? h('span', { class: 'num-range' }, `${m.r[0]} – ${m.r[1]}`) : null;
  const presets = m?.v ? h('select', { class: 'ppresets', 'aria-label': `${name} presets`, title: 'Suggested values', disabled: ro, onchange: (e: Event) => {
    const s = e.target as HTMLSelectElement;
    if (s.value) ctx.stage(name, Number(s.value));
  } }, h('option', { value: '' }, 'Presets'), Object.entries(m.v).map(([v, l]) => h('option', { value: v }, `${l} (${v})`))) : null;
  const el = h('div', { class: 'numwrap' }, input, presets, unit, range);
  return { el, sync: () => {
    const v = ctx.value(name);
    if (document.activeElement !== input) input.value = v === undefined || !Number.isFinite(v) ? input.value : formatValue(v, p.type);
    const r = m?.r;
    input.classList.toggle('is-warn', !!r && v !== undefined && (v < r[0] || v > r[1]));
    if (presets) {
      const key = v === undefined ? '' : formatValue(v, p.type);
      presets.value = presets.querySelector(`option[value="${CSS.escape(key)}"]`) ? key : '';
    }
  } };
}

/** Small pill showing a live value, e.g. current PWM next to a threshold. */
export function livePill(prefix = ''): { el: HTMLElement; set(text: string, level?: 'ok' | 'warn' | 'bad' | ''): void } {
  const el = h('span', { class: 'live' }, h('span', { class: 'live-dot' }), h('span', { class: 'live-text' }, prefix));
  return { el, set(text, level = '') { el.querySelector('.live-text')!.textContent = text; el.dataset.level = level; } };
}
