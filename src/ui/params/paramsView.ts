// Parameter editor: grouped tree, search, typed editors from ArduPilot metadata,
// staged changes with verified writes, .param file load/compare/save.

import { formatValue, isIntType, sameValue, type Param } from '../../vehicle/params';
import { prettyUnit, type ParamMeta } from '../../vehicle/paramMeta';
import type { Staging } from '../staging';
import type { Vehicle } from '../../vehicle/vehicle';
import { confirmDialog, modal } from '../dialog';
import { clear, debounce, download, h, pickFile, storage } from '../dom';
import { toast } from '../toast';
import { parseParamFile, writeParamFile } from './paramFile';
import { familyOf, GENERAL, groupName } from './groups';
import { icon } from '../icons';
import { openConnectDialog } from '../connect';

interface Row {
  el: HTMLElement;
  editor: HTMLInputElement | HTMLSelectElement;
  presets: HTMLSelectElement | null;
  current: HTMLElement;
  details: HTMLElement | null;
}

/** ArduPilot "Values" are a complete list only for integer params with no range; otherwise they're suggestions. */
const isStrictEnum = (p: Param, m?: ParamMeta) => !!m?.v && !m.b && !m.r && isIntType(p.type);

const ALL = '__all__';
const MODIFIED = '__modified__';

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const byGroupName = (a: string, b: string) => (a === GENERAL ? 1 : 0) - (b === GENERAL ? 1 : 0) || groupName(a).localeCompare(groupName(b)) || natural(a, b);

export class ParamsView {
  readonly el: HTMLElement;
  private get meta(): Record<string, ParamMeta> { return this.staging.meta.meta; }
  private get pending() { return this.staging.pending; }
  private rows = new Map<string, Row>();
  private group = storage.get<string>('params.group', ALL);
  private query = '';
  private standardOnly = storage.get('params.standardOnly', false);
  private singles = new Set<string>();
  private singlesFor = -1;

  /** Group key for a parameter, folding one-parameter prefixes into General. */
  private fam(name: string): string {
    const pm = this.vehicle.params.params;
    if (this.singlesFor !== pm.size) {
      const counts = new Map<string, number>();
      for (const n of pm.keys()) { const f = familyOf(n); counts.set(f, (counts.get(f) ?? 0) + 1); }
      this.singles = new Set([...counts].filter(([, c]) => c === 1).map(([f]) => f));
      this.singlesFor = pm.size;
    }
    const f = familyOf(name);
    return this.singles.has(f) ? GENERAL : f;
  }

  private groupList = h('nav', { class: 'pgroups', 'aria-label': 'Parameter groups' });
  private groupSelectHost = h('div', { class: 'pgroup-select-host' });
  private list = h('div', { class: 'plist', role: 'list' });
  private empty = h('div', { class: 'pempty' });
  private progress = h('div', { class: 'pprogress', hidden: true });
  private countText = h('span', { class: 'pcount' });
  private search: HTMLInputElement;
  private renderSoon = debounce(() => this.render(), 120);

  constructor(private vehicle: Vehicle, private staging: Staging) {
    this.search = h('input', {
      class: 'psearch-input', type: 'search', placeholder: 'Search name or description', 'aria-label': 'Search parameters',
      spellcheck: false, autocomplete: 'off',
      oninput: () => { this.query = this.search.value.trim(); this.renderSoon(); },
    });
    const stdToggle = h('label', { class: 'switch', title: 'Hide parameters ArduPilot marks as advanced' },
      h('input', { type: 'checkbox', checked: this.standardOnly, onchange: (e: Event) => {
        this.standardOnly = (e.target as HTMLInputElement).checked;
        storage.set('params.standardOnly', this.standardOnly);
        this.render();
      } }),
      h('span', { class: 'switch-track' }), 'Hide advanced');

    const toolbar = h('div', { class: 'ptoolbar' },
      this.groupSelectHost,
      h('label', { class: 'psearch' }, icon('search'), this.search, h('kbd', { class: 'kbd' }, '/')),
      stdToggle, this.countText,
      h('div', { class: 'ptools' },
        h('button', { class: 'btn', type: 'button', title: 'Read all parameters from the vehicle again', onclick: () => this.refreshAll() }, icon('refresh'), h('span', null, 'Refresh')),
        h('button', { class: 'btn', type: 'button', title: 'Compare a .param file with the vehicle', onclick: () => this.loadFile() }, icon('folder'), h('span', null, 'Load file')),
        h('button', { class: 'btn', type: 'button', title: 'Download all parameters as a .param file', onclick: () => this.saveFile() }, icon('download'), h('span', null, 'Save file')),
      ),
    );

    this.el = h('section', { class: 'view params-view', 'aria-label': 'Parameters' },
      toolbar,
      h('div', { class: 'pbody' }, this.groupList, h('div', { class: 'pmain' }, this.progress, this.empty, this.list)),
    );

    // Keyboard: "/" focuses search
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) && this.el.isConnected) {
        e.preventDefault();
        this.search.focus();
      }
    });

    vehicle.params.onUpdate(() => this.onParamsUpdate());
    staging.meta.onLoad(() => { this.rows.clear(); this.render(); });
    staging.onChange((names) => {
      if (names) for (const n of names) this.syncName(n);
      else for (const n of this.rows.keys()) this.syncName(n);
      this.renderGroups();
      if (this.group === MODIFIED && !this.pending.size && !staging.writing) { this.group = ALL; this.render(); }
    });
    this.render();
  }

  // ---------- data updates ----------

  private lastCount = -1;
  private loggedLoad = -1;
  private onParamsUpdate() {
    const pm = this.vehicle.params;
    const p = pm.progress;
    if (!p.done && p.total) {
      this.progress.hidden = false;
      this.progress.style.setProperty('--pct', `${(100 * p.received) / p.total}%`);
      this.progress.textContent = `Reading parameters… ${p.received} of ${p.total}`;
      this.progress.prepend(icon('download', 16));
    } else if (!p.done) {
      this.progress.hidden = !this.vehicle.connected;
      this.progress.style.setProperty('--pct', '0%');
      this.progress.textContent = 'Waiting for parameters…';
    } else {
      this.progress.hidden = true;
      if (p.error && this.lastCount !== -2) { toast(p.error, 'warn'); this.lastCount = -2; }
      if (p.total && this.loggedLoad !== p.total) { this.loggedLoad = p.total; this.vehicle.log(`Read ${p.received} of ${p.total} parameters${p.error ? ` — ${p.error}` : ''}`, p.error ? 4 : 6); }
    }
    if (pm.params.size === 0) {
      this.loggedLoad = -1;
      if (this.rows.size) this.rows.clear();
      this.render();
      return;
    }
    // Render the full list once loading settles; otherwise just refresh values in place.
    if (p.done && this.lastCount !== pm.params.size) {
      this.lastCount = pm.params.size;
      this.render();
    } else {
      for (const [name, row] of this.rows) {
        const param = pm.get(name);
        if (param) this.syncRow(name, row, param);
      }
      if (!p.done) this.renderSoon();
    }
  }

  // ---------- rendering ----------

  private visibleParams(): Param[] {
    const all = [...this.vehicle.params.params.values()];
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((p) => {
      const m = this.meta[p.name];
      if (this.standardOnly && m?.adv && !this.pending.has(p.name)) return false;
      if (words.length) {
        const hay = `${p.name} ${m?.n ?? ''} ${m?.d ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }
      if (this.group === MODIFIED) return this.pending.has(p.name);
      if (this.group !== ALL) return this.fam(p.name) === this.group;
      return true;
    }).sort((a, b) => this.grouped() ? byGroupName(this.fam(a.name), this.fam(b.name)) || natural(a.name, b.name) : natural(a.name, b.name));
  }

  /** The "all" view shows section headers per group. */
  private grouped() { return this.group === ALL && !this.query; }

  private render() {
    this.renderGroups();
    const pm = this.vehicle.params;
    this.el.classList.toggle('is-empty', pm.params.size === 0);
    if (pm.params.size === 0) {
      clear(this.list);
      this.countText.textContent = '';
      this.empty.hidden = false;
      this.empty.replaceChildren(
        this.vehicle.store.state.link === 'disconnected' ? this.hero()
          : h('div', { class: 'pwait' }, h('div', { class: 'spinner' }), h('h3', null, 'Reading parameters from the vehicle')),
      );
      return;
    }
    const visible = this.visibleParams();
    this.empty.hidden = visible.length > 0;
    if (!visible.length) {
      this.empty.replaceChildren(h('div', { class: 'pnone' }, icon('search', 28), h('h3', null, this.query ? `Nothing matches “${this.query}”` : 'No parameters here'),
        this.query ? h('p', null, 'Search covers names, display names and descriptions.') : null));
    }
    this.countText.textContent = this.query
      ? `${visible.length} match${visible.length === 1 ? '' : 'es'}`
      : `${visible.length} of ${pm.params.size}`;
    if (!this.grouped()) {
      this.list.replaceChildren(...visible.map((p) => this.rowFor(p).el));
      return;
    }
    const nodes: HTMLElement[] = [];
    let fam = '';
    for (const p of visible) {
      const f = this.fam(p.name);
      if (f !== fam) {
        fam = f;
        const ff = f;
        nodes.push(h('div', { class: 'phead', role: 'presentation' },
          h('button', { type: 'button', class: 'phead-btn', title: `Show only ${groupName(ff)}`, onclick: () => this.selectGroup(ff) },
            h('span', { class: 'phead-name' }, groupName(f)), groupName(f) !== f && f !== GENERAL ? h('span', { class: 'phead-code' }, f) : null)));
      }
      nodes.push(this.rowFor(p).el);
    }
    this.list.replaceChildren(...nodes);
  }

  private selectGroup(key: string) {
    this.group = key; storage.set('params.group', key);
    if (this.query) { this.query = ''; this.search.value = ''; }
    this.render();
    this.list.parentElement!.scrollTop = 0;
  }

  private hero(): HTMLElement {
    return h('div', { class: 'hero' },
      h('div', { class: 'hero-art', 'aria-hidden': 'true' }, heroArt()),
      h('h2', null, 'Connect a flight controller'),
      h('p', null, 'Read every parameter with ArduPilot’s own documentation, edit them safely, and compare against saved .param files.'),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn btn-accent btn-lg', type: 'button', onclick: () => openConnectDialog(this.vehicle, 'usb') }, icon('usb'), h('span', null, 'Connect with USB')),
        h('button', { class: 'btn btn-lg', type: 'button', onclick: () => openConnectDialog(this.vehicle, 'net') }, icon('network'), h('span', null, 'Connect over network')),
      ),
      h('ul', { class: 'hero-points' },
        h('li', null, icon('check', 16), 'Copter, Plane and Rover'),
        h('li', null, icon('check', 16), 'Changes are staged and verified before they count'),
        h('li', null, icon('check', 16), 'Works offline once loaded'),
      ),
    );
  }

  private renderGroups() {
    const counts = new Map<string, number>();
    for (const name of this.vehicle.params.params.keys()) {
      const f = this.fam(name);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    if (this.group !== ALL && this.group !== MODIFIED && counts.size && !counts.has(this.group)) this.group = ALL;
    const item = (key: string, label: string, code: string | null, count: number, extra = '', ic?: Parameters<typeof icon>[0]) =>
      h('button', {
        type: 'button', class: `pgroup${extra}`, 'aria-current': this.group === key && !this.query ? 'true' : null,
        onclick: () => this.selectGroup(key),
      },
      ic ? icon(ic, 16) : null,
      h('span', { class: 'pgroup-name' }, label, code ? h('span', { class: 'pgroup-code' }, code) : null),
      h('span', { class: 'pgroup-count' }, String(count)));

    const families = [...counts.keys()].sort(byGroupName);
    const select = h('select', { class: 'pgroup-select', 'aria-label': 'Parameter group', onchange: (e: Event) => {
      this.group = (e.target as HTMLSelectElement).value; storage.set('params.group', this.group); this.render();
    } },
      h('option', { value: ALL, selected: this.group === ALL }, `All parameters (${this.vehicle.params.params.size})`),
      this.pending.size ? h('option', { value: MODIFIED, selected: this.group === MODIFIED }, `Unsaved changes (${this.pending.size})`) : null,
      families.map((f) => h('option', { value: f, selected: this.group === f }, `${groupName(f)} (${counts.get(f)})`)),
    );
    clear(this.groupSelectHost, select);
    clear(this.groupList,
      item(ALL, 'All parameters', null, this.vehicle.params.params.size, ' pgroup-top', 'params'),
      this.pending.size ? item(MODIFIED, 'Unsaved changes', null, this.pending.size, ' pgroup-top pgroup-modified', 'write') : null,
      h('div', { class: 'pgroup-sep' }),
      families.map((f) => item(f, groupName(f), groupName(f) !== f && f !== GENERAL ? f : null, counts.get(f)!)),
    );
  }

  private rowFor(p: Param): Row {
    let row = this.rows.get(p.name);
    if (row) { this.syncRow(p.name, row, p); return row; }
    const m = this.meta[p.name];
    const editor = this.makeEditor(p, m);
    const presets = m?.v && !isStrictEnum(p, m) && !m.b && !m.ro ? this.makePresets(p, m, editor as HTMLInputElement) : null;
    const current = h('span', { class: 'pcurrent' });
    const nameBtn = h('button', { type: 'button', class: 'pname', 'aria-expanded': 'false', title: 'Show details' },
      h('span', { class: 'pid' }, icon('chevron', 14), p.name),
      h('span', { class: 'pdisplay' }, m?.n ?? (this.staging.meta.loaded ? 'Undocumented' : '')),
    );
    const el = h('div', { class: 'prow', role: 'listitem', dataset: { name: p.name } },
      nameBtn,
      h('div', { class: 'pedit' }, presets ? h('div', { class: 'pcombo' }, editor, presets) : editor, current),
      h('span', { class: 'punits' }, prettyUnit(m?.u)),
      h('p', { class: 'pdesc' }, m?.d ?? ''),
    );
    if (m?.rb) el.append(h('span', { class: 'pflag', title: 'Takes effect after a reboot' }, icon('power', 13), 'Reboot'));
    row = { el, editor, presets, current, details: null };
    const r = row;
    nameBtn.addEventListener('click', () => this.toggleDetails(p.name, r, nameBtn));
    this.rows.set(p.name, row);
    this.syncRow(p.name, row, p);
    return row;
  }

  /** Suggested values from the docs, applied into the free-form input. */
  private makePresets(p: Param, m: ParamMeta, input: HTMLInputElement): HTMLSelectElement {
    const sel = h('select', { class: 'ppresets', 'aria-label': `${p.name} presets`, title: 'Suggested values' },
      h('option', { value: '' }, 'Presets'),
      Object.entries(m.v!).map(([v, label]) => h('option', { value: v }, `${label} (${v})`)));
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      input.value = sel.value;
      this.stage(p.name, sel.value);
    });
    return sel;
  }

  private makeEditor(p: Param, m?: ParamMeta): HTMLInputElement | HTMLSelectElement {
    const onEdit = (raw: string) => this.stage(p.name, raw);
    if (isStrictEnum(p, m)) {
      const sel = h('select', { class: 'peditor', 'aria-label': p.name, disabled: !!m?.ro },
        Object.entries(m!.v!).map(([v, label]) => h('option', { value: v }, `${label}`)));
      sel.addEventListener('change', () => onEdit(sel.value));
      return sel;
    }
    const input = h('input', {
      class: 'peditor', 'aria-label': p.name, inputMode: isIntType(p.type) ? 'numeric' : 'decimal',
      spellcheck: false, autocomplete: 'off', readOnly: !!m?.ro,
    });
    input.addEventListener('input', () => onEdit(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.staging.unstage(p.name); input.blur(); }
      if (e.key === 'Enter') input.blur();
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !m?.ro) {
        e.preventDefault();
        const step = m?.i ?? (isIntType(p.type) ? 1 : 0.01);
        const base = Number(input.value);
        if (!Number.isFinite(base)) return;
        const next = Number((base + (e.key === 'ArrowUp' ? step : -step)).toPrecision(7));
        input.value = formatValue(next, p.type);
        onEdit(input.value);
      }
    });
    input.addEventListener('blur', () => {
      const param = this.vehicle.params.get(p.name);
      const row = this.rows.get(p.name);
      if (param && row) this.syncRow(p.name, row, param);
    });
    return input;
  }

  /** Puts the vehicle value or the staged value into the row, and sets its state. */
  private syncRow(name: string, row: Row, p: Param) {
    const m = this.meta[name];
    const staged = this.pending.get(name);
    const shown = staged ?? p.value;
    const ed = row.editor;
    if (ed instanceof HTMLSelectElement) {
      const key = formatValue(shown, p.type);
      if (!ed.querySelector(`option[value="${CSS.escape(key)}"]`)) {
        ed.querySelector('option[data-custom]')?.remove();
        ed.append(h('option', { value: key, dataset: { custom: '1' } }, `${key} (not in list)`));
      }
      ed.value = key;
    } else if (document.activeElement !== ed) {
      ed.value = formatValue(shown, p.type);
    }
    if (row.presets) {
      const key = formatValue(shown, p.type);
      row.presets.value = row.presets.querySelector(`option[value="${CSS.escape(key)}"]`) ? key : '';
    }
    const isPending = staged !== undefined;
    row.el.classList.toggle('is-pending', isPending);
    row.current.textContent = isPending ? `was ${this.describe(p.value, p.type, m)}` : '';
    const issue = this.validate(name, isPending ? staged : p.value, p, m);
    row.el.classList.toggle('is-warn', !!issue && isPending);
    row.el.title = issue && isPending ? issue : '';
    if (row.details) this.fillDetails(name, row.details, p, m);
  }

  private describe(v: number, type: number, m?: ParamMeta) {
    const s = formatValue(v, type);
    return m?.v?.[s] ? `${m.v[s]} (${s})` : s;
  }

  private validate(_name: string, v: number, p: Param, m?: ParamMeta): string | null {
    if (!Number.isFinite(v)) return 'Not a number';
    if (isIntType(p.type) && !Number.isInteger(v)) return 'Whole numbers only';
    if (m?.r && (v < m.r[0] || v > m.r[1])) return `Outside the documented range ${m.r[0]} … ${m.r[1]}`;
    return null;
  }

  private stage(name: string, raw: string) {
    const v = raw.trim() === '' ? NaN : Number(raw.replace(',', '.'));
    this.staging.stage(name, v);
  }

  private syncName(name: string) {
    const row = this.rows.get(name);
    const p = this.vehicle.params.get(name);
    if (row && p) this.syncRow(name, row, p);
  }

  /** Shows only staged changes (used by the tray's Review button). */
  showModified() {
    if (!this.pending.size) return;
    this.group = MODIFIED; this.query = ''; this.search.value = '';
    this.render();
  }

  // ---------- details panel ----------

  private toggleDetails(name: string, row: Row, btn: HTMLElement) {
    if (row.details) {
      row.details.remove(); row.details = null;
      btn.setAttribute('aria-expanded', 'false');
      return;
    }
    row.details = h('div', { class: 'pdetails' });
    row.el.append(row.details);
    btn.setAttribute('aria-expanded', 'true');
    const p = this.vehicle.params.get(name);
    if (p) this.fillDetails(name, row.details, p, this.meta[name]);
  }

  private fillDetails(name: string, box: HTMLElement, p: Param, m?: ParamMeta) {
    const value = this.pending.get(name) ?? p.value;
    const facts: [string, string][] = [];
    if (m?.r) facts.push(['Range', `${m.r[0]} … ${m.r[1]}${m.u ? ' ' + prettyUnit(m.u) : ''}`]);
    if (m?.i) facts.push(['Increment', String(m.i)]);
    facts.push(['On vehicle', this.describe(p.value, p.type, m)]);
    if (m?.rb) facts.push(['Applies', 'after reboot']);
    if (m?.ro) facts.push(['Access', 'read-only']);

    const bits = m?.b ? h('fieldset', { class: 'pbits' },
      h('legend', null, 'Bits'),
      Object.entries(m.b).map(([bit, label]) => {
        const mask = 2 ** Number(bit);
        const on = Math.floor(value / mask) % 2 === 1;
        return h('label', { class: 'pbit' },
          h('input', { type: 'checkbox', checked: on, disabled: !!m.ro, onchange: (e: Event) => {
            const cur = this.pending.get(name) ?? p.value;
            const was = Math.floor(cur / mask) % 2 === 1;
            const checked = (e.target as HTMLInputElement).checked;
            const next = checked === was ? cur : checked ? cur + mask : cur - mask;
            this.stage(name, String(next));
          } }),
          h('span', null, label), h('span', { class: 'pbit-n' }, `bit ${bit}`));
      })) : null;

    const values = m?.v && m.b ? h('div', { class: 'pvalues' }, Object.entries(m.v).map(([k, v]) => h('span', null, `${k}: ${v}`))) : null;

    clear(box,
      m?.d ? h('p', { class: 'pdetails-desc' }, m.d) : h('p', { class: 'pdetails-desc muted' }, 'No documentation for this parameter in ArduPilot’s metadata.'),
      h('dl', { class: 'pfacts' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      bits, values,
      h('div', { class: 'pdetails-actions' },
        this.pending.has(name) ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => this.staging.unstage(name) }, icon('undo', 16), h('span', null, 'Undo change')) : null,
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
          try { await this.vehicle.params.refresh(name); toast(`${name} re-read from vehicle`, 'ok', 1500); } catch { toast(`No reply for ${name}`, 'warn'); }
        } }, icon('reread', 16), h('span', null, 'Re-read')),
      ),
    );
  }

  // ---------- toolbar actions ----------

  private async refreshAll() {
    if (!this.vehicle.connected) { toast('Not connected', 'warn'); return; }
    if (this.pending.size && !(await confirmDialog('Re-read all parameters?', 'Your staged changes are kept and shown against the fresh values.', 'Re-read'))) return;
    this.lastCount = -1;
    const keep = [...this.pending];
    await this.vehicle.params.fetchAll();
    this.staging.stageMany(keep.filter(([k]) => this.vehicle.params.get(k)));
    this.rows.clear();
    this.render();
  }

  private saveFile() {
    const pm = this.vehicle.params;
    if (!pm.params.size) { toast('No parameters to save yet', 'warn'); return; }
    const s = this.vehicle.store.state;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
    const text = writeParamFile(
      [...pm.params.values()].map((p) => [p.name, formatValue(p.value, p.type)]),
      [`Saved by WebPlanner ${new Date().toISOString()}`, `${s.firmware || s.vehicleClass}, sysid ${s.sysid}`, `${pm.params.size} parameters (values as on vehicle; unsaved changes not included)`],
    );
    download(`${(s.firmware || 'vehicle').replace(/\s+/g, '_')}_${stamp}.param`, text);
  }

  private async loadFile() {
    const pm = this.vehicle.params;
    if (!pm.params.size) { toast('Connect and load parameters first, so the file can be compared', 'warn'); return; }
    const file = await pickFile('.param,.parm,.params,.txt');
    if (!file) return;
    const { values, skipped } = parseParamFile(await file.text());
    const diffs: { name: string; current: Param; value: number }[] = [];
    const missing: string[] = [];
    let same = 0;
    for (const [name, value] of values) {
      const cur = pm.get(name);
      if (!cur) { missing.push(name); continue; }
      if (sameValue(cur.value, value)) { same++; continue; }
      if (this.meta[name]?.ro) continue;
      diffs.push({ name, current: cur, value });
    }
    diffs.sort((a, b) => natural(a.name, b.name));
    this.showCompare(file.name, diffs, same, missing, skipped);
  }

  private showCompare(fileName: string, diffs: { name: string; current: Param; value: number }[], same: number, missing: string[], skipped: number) {
    const boxes = new Map<string, HTMLInputElement>();
    const all = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Select all', onchange: (e: Event) => {
      for (const b of boxes.values()) b.checked = (e.target as HTMLInputElement).checked;
    } });
    const table = diffs.length ? h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
      h('thead', null, h('tr', null, h('th', null, all), h('th', null, 'Parameter'), h('th', null, 'On vehicle'), h('th', null, 'In file'))),
      h('tbody', null, diffs.map((d) => {
        const m = this.meta[d.name];
        const cb = h('input', { type: 'checkbox', checked: true, 'aria-label': d.name });
        boxes.set(d.name, cb);
        return h('tr', null,
          h('td', null, cb),
          h('td', null, h('span', { class: 'mono' }, d.name), m?.n ? h('span', { class: 'cmp-sub' }, m.n) : null),
          h('td', { class: 'mono' }, this.describe(d.current.value, d.current.type, m)),
          h('td', { class: 'mono cmp-new' }, this.describe(d.value, d.current.type, m)));
      })))) : h('p', null, 'Every parameter in the file already matches the vehicle.');

    const summary = [
      `${diffs.length} different`, `${same} identical`,
      missing.length ? `${missing.length} not on this vehicle` : '',
      skipped ? `${skipped} unreadable lines` : '',
    ].filter(Boolean).join(', ');

    const m = modal(`Compare with ${fileName}`, h('div', null,
      h('p', { class: 'hint' }, summary + '. Selected values are staged as unsaved changes — review them, then write.'),
      table,
      missing.length ? h('details', { class: 'cmp-missing' }, h('summary', null, 'Parameters in the file that this vehicle doesn’t have'),
        h('p', { class: 'mono' }, missing.join(' '))) : null,
    ), [
      h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Close'),
      diffs.length ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
        let n = 0;
        const chosen = diffs.filter((d) => boxes.get(d.name)!.checked).map((d): [string, number] => [d.name, d.value]);
        this.staging.stageMany(chosen);
        n = chosen.length;
        m.close();
        if (n) { this.group = MODIFIED; this.query = ''; this.search.value = ''; this.render(); toast(`Staged ${n} change${n === 1 ? '' : 's'} from ${fileName}`, 'ok'); }
      } }, icon('diff'), h('span', null, 'Stage selected')) : null,
    ], { wide: true });
  }
}

function heroArt(): SVGElement {
  // A quadcopter seen from above, drawn with the app's ink and amber tokens.
  const ns = 'http://www.w3.org/2000/svg';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg xmlns="${ns}" viewBox="0 0 240 160" width="240" height="160">
    <g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round">
      <path d="M78 46 L162 114 M162 46 L78 114"/>
    </g>
    <g fill="none" stroke="currentColor" stroke-width="3" opacity=".35">
      <circle cx="70" cy="40" r="30"/><circle cx="170" cy="40" r="30"/>
      <circle cx="70" cy="120" r="30"/><circle cx="170" cy="120" r="30"/>
    </g>
    <g fill="currentColor"><circle cx="70" cy="40" r="7"/><circle cx="170" cy="40" r="7"/><circle cx="70" cy="120" r="7"/><circle cx="170" cy="120" r="7"/></g>
    <rect x="98" y="62" width="44" height="36" rx="8" fill="var(--amber)"/>
    <path d="M120 70 L128 82 H112 Z" fill="var(--ink)"/>
  </svg>`;
  return wrap.firstElementChild as SVGElement;
}
