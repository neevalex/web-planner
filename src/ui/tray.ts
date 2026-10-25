// App-level write tray and reboot prompt for staged parameter changes.
import type { Staging } from './staging';
import { confirmDialog } from './dialog';
import { clear, h } from './dom';
import { icon } from './icons';
import { toast } from './toast';
import { rebootVehicle } from './reboot';

export function writeTray(staging: Staging, onReview: () => void): { tray: HTMLElement; reboot: HTMLElement } {
  const tray = h('div', { class: 'tray', hidden: true });
  const reboot = h('div', { class: 'reboot-bar', hidden: true });
  const vehicle = staging.vehicle;

  const render = () => {
    const n = staging.pending.size;
    tray.hidden = n === 0;
    if (n) {
      const invalid = staging.invalid();
      const outOfRange = staging.outOfRange();
      clear(tray,
        h('span', { class: 'tray-dot', 'aria-hidden': 'true' }),
        h('div', { class: 'tray-text' },
          h('strong', null, `${n} unsaved change${n === 1 ? '' : 's'}`),
          invalid.length ? h('span', { class: 'tray-warn' }, icon('warn', 14), `${invalid.length} not a valid number`)
            : outOfRange.length ? h('span', { class: 'tray-warn' }, icon('warn', 14), `${outOfRange.length} outside documented range`) : null,
        ),
        h('button', { class: 'btn', type: 'button', title: 'Show all unsaved changes', onclick: onReview }, icon('review'), h('span', null, 'Review')),
        h('button', { class: 'btn', type: 'button', disabled: staging.writing, onclick: async () => {
          if (await confirmDialog('Discard changes?', `${n} staged change${n === 1 ? '' : 's'} will be dropped. Nothing has been written to the vehicle.`, 'Discard', true)) staging.discard();
        } }, icon('undo'), h('span', null, 'Discard')),
        h('button', { class: 'btn btn-write', type: 'button', disabled: staging.writing || invalid.length > 0 || !vehicle.connected, onclick: write },
          icon('write'), h('span', { class: 'btn-write-label' }, staging.writing ? 'Writing…' : [`Write ${n}`, h('span', { class: 'hide-sm' }, ' to vehicle')])),
      );
    }
    reboot.hidden = staging.rebootNeeded.size === 0;
    if (staging.rebootNeeded.size) {
      const names = [...staging.rebootNeeded];
      clear(reboot,
        icon('info'),
        h('span', null, `Reboot the flight controller to apply ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}.`),
        h('button', { class: 'btn btn-small', type: 'button', onclick: rebootNow }, icon('power', 16), h('span', null, 'Reboot now')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: () => staging.clearReboot() }, icon('close')),
      );
    }
  };

  async function write() {
    const out = staging.outOfRange();
    if (out.length && !(await confirmDialog('Write values outside the documented range?',
      `${out.join(', ')} ${out.length === 1 ? 'is' : 'are'} outside ArduPilot’s documented range. The vehicle may still accept ${out.length === 1 ? 'it' : 'them'}.`, 'Write anyway', true))) return;
    const { written, failed } = await staging.writeAll((done, total) => {
      const label = tray.querySelector('.btn-write-label');
      if (label) label.textContent = `Writing ${done} of ${total}…`;
    });
    if (written) toast(`Wrote ${written} parameter${written === 1 ? '' : 's'}`, 'ok');
    for (const f of failed.slice(0, 3)) toast(f.error, 'error');
    if (failed.length > 3) toast(`${failed.length - 3} more failed — they stay staged`, 'error');
  }

  const rebootNow = () => rebootVehicle(vehicle, staging);

  staging.onChange(render);
  let wasConnected = vehicle.connected;
  vehicle.store.subscribe(() => {
    if (vehicle.connected !== wasConnected) { wasConnected = vehicle.connected; render(); }
  });
  render();
  return { tray, reboot };
}
