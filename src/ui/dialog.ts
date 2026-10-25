import { h } from './dom';

/** Modal built on <dialog>. Returns the dialog and a close() that removes it. */
export function modal(title: string, body: Node, actions: (Node | null)[] = [], opts: { wide?: boolean } = {}) {
  const dlg = h('dialog', { class: `modal${opts.wide ? ' modal-wide' : ''}` },
    h('header', { class: 'modal-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'modal-body' }, body),
    actions.some(Boolean) ? h('footer', { class: 'modal-foot' }, actions) : null,
  );
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

export function confirmDialog(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => { m.close(); resolve(v); };
    const m = modal(title, h('p', null, message), [
      h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
      h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => done(true) }, okLabel),
    ]);
    m.dlg.addEventListener('close', () => resolve(false), { once: true });
  });
}
