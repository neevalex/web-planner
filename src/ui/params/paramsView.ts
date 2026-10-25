// Parameter editor: grouped tree, search, typed editors from ArduPilot metadata,
// staged changes with verified writes, .param file load/compare/save.

import { formatValue, isIntType, sameValue, type Param } from '../../vehicle/params';
import { loadParamMeta, prettyUnit, type ParamMeta } from '../../vehicle/paramMeta';
import type { Vehicle } from '../../vehicle/vehicle';
import { confirmDialog, modal } from '../dialog';
import { clear, debounce, download, h, pickFile, storage } from '../dom';
import { toast } from '../toast';
import { parseParamFile, writeParamFile } from './paramFile';

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

const familyOf = (name: string) => {
  const head = name.includes('_') ? name.slice(0, name.indexOf('_')) : name;
  return head.replace(/\d+$/, '') || head;
};
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export class ParamsView {
  readonly el: HTMLElement;
  private meta: Record<string, ParamMeta> = {};
  private metaFor = '';
  private pending = new Map<string, number>();
  private rebootNeeded = new Set<string>();
  private rows = new Map<string, Row>();
  private group = storage.get<string>('params.group', ALL);
  private query = '';
  private standardOnly = storage.get('params.standardOnly', false);
  private writing = false;

  private groupList = h('nav', { class: 'pgroups', 'aria-label': 'Parameter groups' });
  private groupSelectHost = h('div', { class: 'pgroup-select-host' });
  private list = h('div', { class: 'plist', role: 'list' });
  private empty = h('div', { class: 'pempty' });
  private progress = h('div', { class: 'pprogress', hidden: true });
  private countText = h('span', { class: 'pcount' });
  private tray = h('div', { class: 'tray', hidden: true });
  private rebootBar = h('div', { class: 'reboot-bar', hidden: true });
  private search: HTMLInputElement;
  private renderSoon = debounce(() => this.render(), 120);

  constructor(private vehicle: Vehicle) {
    this.search = h('input', {
      class: 'psearch', type: 'search', placeholder: 'Search name or description', 'aria-label': 'Search parameters',
      spellcheck: false, autocomplete: 'off',
      oninput: () => { this.query = this.search.value.trim(); this.renderSoon(); },
    });
    const stdToggle = h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: this.standardOnly, onchange: (e: Event) => {
        this.standardOnly = (e.target as HTMLInputElement).checked;
        storage.set('params.standardOnly', this.standardOnly);
        this.render();
      } }),
      'Hide advanced');

    const toolbar = h('div', { class: 'ptoolbar' },
      this.groupSelectHost, this.search, stdToggle, this.countText,
      h('div', { class: 'ptools' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.refreshAll() }, 'Refresh'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.loadFile() }, 'Load file…'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.saveFile() }, 'Save file'),
      ),
    );

    this.el = h('section', { class: 'view params-view', 'aria-label': 'Parameters' },
      toolbar, this.rebootBar,
      h('div', { class: 'pbody' }, this.groupList, h('div', { class: 'pmain' }, this.progress, this.empty, this.list)),
      this.tray,
    );

    // Keyboard: "/" focuses search
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) && this.el.isConnected) {
        e.preventDefault();
        this.search.focus();
      }
    });

    vehicle.params.onUpdate(() => this.onParamsUpdate());
    vehicle.store.subscribe((s) => {
      if (s.vehicleClass !== 'unknown' && s.vehicleClass !== this.metaFor) {
        this.metaFor = s.vehicleClass;
        void loadParamMeta(s.vehicleClass).then((m) => { this.meta = m; this.rows.clear(); this.render(); });
      }
    });
    this.render();
  }

  // ---------- data updates ----------

  private lastCount = -1;
  private onParamsUpdate() {
    const pm = this.vehicle.params;
    const p = pm.progress;
    if (!p.done && p.total) {
      this.progress.hidden = false;
      this.progress.style.setProperty('--pct', `${(100 * p.received) / p.total}%`);
      this.progress.textContent = `Reading parameters… ${p.received} of ${p.total}`;
    } else if (!p.done) {
      this.progress.hidden = !this.vehicle.connected;
      this.progress.style.setProperty('--pct', '0%');
      this.progress.textContent = 'Waiting for parameters…';
    } else {
      this.progress.hidden = true;
      if (p.error && this.lastCount !== -2) { toast(p.error, 'warn'); this.lastCount = -2; }
    }
    if (pm.params.size === 0) {
      if (this.rows.size) { this.rows.clear(); this.pending.clear(); this.renderTray(); }
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
      if (this.group !== ALL) return familyOf(p.name) === this.group;
      return true;
    }).sort((a, b) => natural(a.name, b.name));
  }

  private render() {
    this.renderGroups();
    const pm = this.vehicle.params;
    if (pm.params.size === 0) {
      clear(this.list);
      this.countText.textContent = '';
      this.empty.hidden = false;
      this.empty.replaceChildren(
        this.vehicle.store.state.link === 'disconnected'
          ? h('div', null, h('h3', null, 'Connect a vehicle to edit its parameters'),
              h('p', null, 'You can still open a .param file after connecting to compare it with the vehicle.'))
          : h('div', null, h('h3', null, 'Waiting for parameters from the vehicle')),
      );
      return;
    }
    const visible = this.visibleParams();
    this.empty.hidden = visible.length > 0;
    if (!visible.length) {
      this.empty.replaceChildren(h('div', null, h('h3', null, this.query ? `Nothing matches “${this.query}”` : 'No parameters here'),
        this.query ? h('p', null, 'Search covers names, display names and descriptions.') : null));
    }
    this.countText.textContent = this.query
      ? `${visible.length} match${visible.length === 1 ? '' : 'es'}`
      : `${visible.length} of ${pm.params.size}`;
    this.list.replaceChildren(...visible.map((p) => this.rowFor(p).el));
  }

  private renderGroups() {
    const counts = new Map<string, number>();
    for (const name of this.vehicle.params.params.keys()) {
      const f = familyOf(name);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    if (this.group !== ALL && this.group !== MODIFIED && counts.size && !counts.has(this.group)) this.group = ALL;
    const item = (key: string, label: string, count: number, extra = '') =>
      h('button', {
        type: 'button', class: `pgroup${extra}`, 'aria-current': this.group === key && !this.query ? 'true' : null,
        onclick: () => {
          this.group = key; storage.set('params.group', key);
          if (this.query) { this.query = ''; this.search.value = ''; }
          this.render();
          this.list.scrollTop = 0;
        },
      }, h('span', { class: 'pgroup-name' }, label), h('span', { class: 'pgroup-count' }, String(count)));

    const families = [...counts.keys()].sort(natural);
    const select = h('select', { class: 'pgroup-select', 'aria-label': 'Parameter group', onchange: (e: Event) => {
      this.group = (e.target as HTMLSelectElement).value; storage.set('params.group', this.group); this.render();
    } },
      h('option', { value: ALL, selected: this.group === ALL }, `All parameters (${this.vehicle.params.params.size})`),
      this.pending.size ? h('option', { value: MODIFIED, selected: this.group === MODIFIED }, `Unsaved changes (${this.pending.size})`) : null,
      families.map((f) => h('option', { value: f, selected: this.group === f }, `${f} (${counts.get(f)})`)),
    );
    clear(this.groupSelectHost, select);
    clear(this.groupList,
      item(ALL, 'All parameters', this.vehicle.params.params.size),
      this.pending.size ? item(MODIFIED, 'Unsaved changes', this.pending.size, ' pgroup-modified') : null,
      h('div', { class: 'pgroup-sep' }),
      families.map((f) => item(f, f, counts.get(f)!)),
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
      h('span', { class: 'pid' }, p.name),
      h('span', { class: 'pdisplay' }, m?.n ?? (Object.keys(this.meta).length ? 'Undocumented' : '')),
    );
    const el = h('div', { class: 'prow', role: 'listitem', dataset: { name: p.name } },
      nameBtn,
      h('div', { class: 'pedit' }, presets ? h('div', { class: 'pcombo' }, editor, presets) : editor, current),
      h('span', { class: 'punits' }, prettyUnit(m?.u)),
      h('p', { class: 'pdesc' }, m?.d ?? ''),
    );
    if (m?.rb) el.append(h('span', { class: 'pflag', title: 'Takes effect after a reboot' }, 'Reboot'));
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
      if (e.key === 'Escape') { this.pending.delete(p.name); this.afterStage(p.name); input.blur(); }
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
    const p = this.vehicle.params.get(name);
    if (!p) return;
    const v = raw.trim() === '' ? NaN : Number(raw.replace(',', '.'));
    if (Number.isFinite(v) && sameValue(v, p.value)) this.pending.delete(name);
    else this.pending.set(name, v);
    this.afterStage(name);
  }

  private afterStage(name: string) {
    const row = this.rows.get(name);
    const p = this.vehicle.params.get(name);
    if (row && p) this.syncRow(name, row, p);
    this.renderTray();
    this.renderGroups();
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
        this.pending.has(name) ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => { this.pending.delete(name); this.afterStage(name); } }, 'Undo change') : null,
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
          try { await this.vehicle.params.refresh(name); toast(`${name} re-read from vehicle`, 'ok', 1500); } catch { toast(`No reply for ${name}`, 'warn'); }
        } }, 'Re-read'),
      ),
    );
  }

  // ---------- write tray ----------

  private renderTray() {
    const n = this.pending.size;
    this.tray.hidden = n === 0;
    if (!n) return;
    const invalid = [...this.pending].filter(([name, v]) => {
      const p = this.vehicle.params.get(name);
      return !p || !Number.isFinite(v) || (isIntType(p.type) && !Number.isInteger(v));
    });
    const outOfRange = [...this.pending].filter(([name, v]) => {
      const r = this.meta[name]?.r;
      return r && Number.isFinite(v) && (v < r[0] || v > r[1]);
    });
    clear(this.tray,
      h('div', { class: 'tray-text' },
        h('strong', null, `${n} unsaved change${n === 1 ? '' : 's'}`),
        invalid.length ? h('span', { class: 'tray-warn' }, `${invalid.length} not a valid number`) :
          outOfRange.length ? h('span', { class: 'tray-warn' }, `${outOfRange.length} outside documented range`) : null,
      ),
      h('button', { class: 'btn', type: 'button', onclick: () => { this.group = MODIFIED; this.query = ''; this.search.value = ''; this.render(); } }, 'Review'),
      h('button', { class: 'btn', type: 'button', disabled: this.writing, onclick: async () => {
        if (await confirmDialog('Discard changes?', `${n} staged change${n === 1 ? '' : 's'} will be dropped. Nothing has been written to the vehicle.`, 'Discard', true)) {
          const names = [...this.pending.keys()];
          this.pending.clear();
          for (const nm of names) this.afterStage(nm);
          if (this.group === MODIFIED) { this.group = ALL; this.render(); }
        }
      } }, 'Discard'),
      h('button', { class: 'btn btn-write', type: 'button', disabled: this.writing || invalid.length > 0 || !this.vehicle.connected,
        onclick: () => this.writePending() }, this.writing ? 'Writing…' : `Write ${n} to vehicle`),
    );
  }

  private async writePending() {
    const entries = [...this.pending];
    const outOfRange = entries.filter(([name, v]) => { const r = this.meta[name]?.r; return r && (v < r[0] || v > r[1]); });
    if (outOfRange.length && !(await confirmDialog('Write values outside the documented range?',
      `${outOfRange.map(([n]) => n).join(', ')} ${outOfRange.length === 1 ? 'is' : 'are'} outside ArduPilot’s documented range. The vehicle may still accept ${outOfRange.length === 1 ? 'it' : 'them'}.`,
      'Write anyway', true))) return;

    this.writing = true;
    this.renderTray();
    const failed = await this.vehicle.params.setMany(entries, (done, total) => {
      const btn = this.tray.querySelector('.btn-write');
      if (btn) btn.textContent = `Writing ${done} of ${total}…`;
    });
    this.writing = false;
    const failedNames = new Set(failed.map((f) => f.name));
    for (const [name] of entries) {
      if (failedNames.has(name)) continue;
      this.pending.delete(name);
      if (this.meta[name]?.rb) this.rebootNeeded.add(name);
      this.afterStage(name);
    }
    const ok = entries.length - failed.length;
    if (ok) toast(`Wrote ${ok} parameter${ok === 1 ? '' : 's'}`, 'ok');
    for (const f of failed.slice(0, 3)) toast(f.error, 'error');
    if (failed.length > 3) toast(`${failed.length - 3} more failed — they stay staged`, 'error');
    this.renderTray();
    this.renderReboot();
    if (this.group === MODIFIED && !this.pending.size) { this.group = ALL; this.render(); }
  }

  private renderReboot() {
    this.rebootBar.hidden = this.rebootNeeded.size === 0;
    if (!this.rebootNeeded.size) return;
    clear(this.rebootBar,
      h('span', null, `Reboot the flight controller to apply ${[...this.rebootNeeded].slice(0, 4).join(', ')}${this.rebootNeeded.size > 4 ? ` and ${this.rebootNeeded.size - 4} more` : ''}.`),
      h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
        if (this.vehicle.store.state.armed) { toast('Disarm before rebooting', 'warn'); return; }
        if (!(await confirmDialog('Reboot flight controller?', 'The link will drop for a few seconds. Parameters are reloaded when it comes back.', 'Reboot'))) return;
        try { await this.vehicle.reboot(); } catch { /* many boards reboot before acking */ }
        this.rebootNeeded.clear();
        this.renderReboot();
        toast('Rebooting…', 'info');
        this.awaitRebootAndReload();
      } }, 'Reboot now'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: () => { this.rebootNeeded.clear(); this.renderReboot(); } }, '✕'),
    );
  }

  /** After a reboot, wait for heartbeats to stop and resume, then re-read parameters. */
  private awaitRebootAndReload() {
    const start = performance.now();
    let sawLoss = false;
    const unsub = this.vehicle.store.subscribe((s) => {
      if (s.link === 'lost') sawLoss = true;
      if (sawLoss && s.link === 'connected') { unsub(); void this.vehicle.params.fetchAll(); }
      if (performance.now() - start > 60000) unsub();
    });
  }

  // ---------- toolbar actions ----------

  private async refreshAll() {
    if (!this.vehicle.connected) { toast('Not connected', 'warn'); return; }
    if (this.pending.size && !(await confirmDialog('Re-read all parameters?', 'Your staged changes are kept and shown against the fresh values.', 'Re-read'))) return;
    this.lastCount = -1;
    const keep = new Map(this.pending);
    await this.vehicle.params.fetchAll();
    for (const [k, v] of keep) if (this.vehicle.params.get(k)) this.pending.set(k, v);
    this.rows.clear();
    this.render();
    this.renderTray();
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
        for (const d of diffs) if (boxes.get(d.name)!.checked) { this.pending.set(d.name, d.value); n++; }
        m.close();
        if (n) { this.group = MODIFIED; this.query = ''; this.search.value = ''; this.render(); this.renderTray(); toast(`Staged ${n} change${n === 1 ? '' : 's'} from ${fileName}`, 'ok'); }
      } }, 'Stage selected') : null,
    ], { wide: true });
  }
}
