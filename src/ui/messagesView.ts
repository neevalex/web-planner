// Messages from the autopilot (STATUSTEXT): prearm failures, calibration results, etc.
import type { StatusMessage } from '../vehicle/state';
import type { Vehicle } from '../vehicle/vehicle';
import { h } from './dom';

const SEVERITY = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Debug'];

export function messagesView(vehicle: Vehicle, onUnread: (n: number) => void): { el: HTMLElement; markRead: () => void } {
  const list = h('ol', { class: 'msglist', 'aria-live': 'polite' });
  const empty = h('p', { class: 'msgempty' }, 'Messages from the flight controller appear here — pre-arm failures, calibration results and warnings.');
  let rendered: StatusMessage[] = [];
  let unread = 0;
  const el = h('section', { class: 'view messages-view', 'aria-label': 'Messages' },
    h('div', { class: 'msgbar' },
      h('h2', null, 'Messages'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => { vehicle.store.update({ messages: [] }); } }, 'Clear'),
    ),
    empty, list);

  vehicle.store.subscribe((s) => {
    if (s.messages === rendered) return;
    const fresh = s.messages.length >= rendered.length && rendered.every((m, i) => s.messages[i] === m)
      ? s.messages.slice(rendered.length) : null;
    if (!fresh) list.replaceChildren();
    const items = fresh ?? s.messages;
    for (const m of items) {
      list.prepend(h('li', { class: `msg sev-${m.severity}` },
        h('time', null, new Date(m.time).toLocaleTimeString()),
        h('span', { class: 'msgsev' }, SEVERITY[m.severity] ?? ''),
        h('span', { class: 'msgtext' }, m.text)));
      if (m.severity <= 4 && !el.isConnected) unread++;
    }
    rendered = s.messages;
    empty.hidden = s.messages.length > 0;
    onUnread(unread);
  });
  return { el, markRead: () => { unread = 0; onUnread(0); } };
}
