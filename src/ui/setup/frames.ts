// Multicopter motor layouts (from ArduPilot's AP_MotorsMatrix) and an SVG diagram.
// angle: degrees clockwise from the nose. cw: propeller spins clockwise seen from above.
import { svg } from './svg';

export interface Motor { n: number; angle: number; cw: boolean }
export interface Layout { name: string; motors: Motor[]; /** test letter per motor number */ order: Map<number, string> }

const M = (n: number, angle: number, cw: boolean): Motor => ({ n, angle, cw });

const LAYOUTS: Record<string, { name: string; motors: Motor[] }> = {
  '1:0': { name: 'Quad +', motors: [M(1, 90, false), M(2, -90, false), M(3, 0, true), M(4, 180, true)] },
  '1:1': { name: 'Quad X', motors: [M(1, 45, false), M(2, -135, false), M(3, -45, true), M(4, 135, true)] },
  '1:3': { name: 'Quad H', motors: [M(1, 45, true), M(2, -135, true), M(3, -45, false), M(4, 135, false)] },
  '1:12': { name: 'Quad X (Betaflight order)', motors: [M(1, 135, true), M(2, 45, false), M(3, -135, false), M(4, -45, true)] },
  '1:18': { name: 'Quad X (Betaflight, reversed)', motors: [M(1, 135, false), M(2, 45, true), M(3, -135, true), M(4, -45, false)] },
  '2:0': { name: 'Hexa +', motors: [M(1, 0, true), M(2, 180, false), M(3, -120, true), M(4, 60, false), M(5, -60, false), M(6, 120, true)] },
  '2:1': { name: 'Hexa X', motors: [M(1, 90, true), M(2, -90, false), M(3, -30, true), M(4, 150, false), M(5, 30, false), M(6, -150, true)] },
  '3:0': { name: 'Octa +', motors: [M(1, 0, true), M(2, 180, true), M(3, 45, false), M(4, 135, false), M(5, -45, false), M(6, -135, false), M(7, -90, true), M(8, 90, true)] },
  '3:1': { name: 'Octa X', motors: [M(1, 22.5, true), M(2, -157.5, true), M(3, 67.5, false), M(4, 157.5, false), M(5, -22.5, false), M(6, -112.5, false), M(7, -67.5, true), M(8, 112.5, true)] },
};

/** ArduPilot's motor test numbers motors clockwise from the nose: A, B, C… */
function testOrder(motors: Motor[]): Map<number, string> {
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const sorted = [...motors].sort((a, b) => norm(a.angle) - norm(b.angle));
  return new Map(sorted.map((m, i) => [m.n, String.fromCharCode(65 + i)]));
}

export function layoutFor(frameClass: number, frameType: number): Layout | null {
  const l = LAYOUTS[`${frameClass}:${frameType}`];
  return l ? { ...l, order: testOrder(l.motors) } : null;
}

/** Motor count for a frame class, for motor-test buttons when there's no diagram. */
export function motorCount(frameClass: number): number {
  return ({ 1: 4, 2: 6, 3: 8, 4: 8, 5: 6, 7: 3, 8: 1, 9: 2, 10: 2, 12: 12, 13: 4, 14: 10 } as Record<number, number>)[frameClass] ?? 4;
}

export interface DiagramOpts { outputs?: Map<number, number>; active?: number | null; onMotor?: (n: number) => void; size?: number }

/** Top-down frame drawing: arms, props with spin arrows, motor number, test letter and output. */
export function frameDiagram(layout: Layout, opts: DiagramOpts = {}): SVGSVGElement {
  const S = 360, c = S / 2, armR = 120, propR = layout.motors.length > 6 ? 34 : 44;
  const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'frame-svg', role: 'img', 'aria-label': `${layout.name} motor layout` });
  // nose marker
  root.append(svg('path', { d: `M${c - 14} 22 L${c} 4 L${c + 14} 22`, class: 'fd-nose' }));
  root.append(svg('text', { x: c, y: 40, class: 'fd-front' }, 'FRONT'));
  for (const m of layout.motors) {
    const a = (m.angle * Math.PI) / 180;
    const x = c + Math.sin(a) * armR, y = c - Math.cos(a) * armR;
    root.append(svg('line', { x1: c, y1: c, x2: x, y2: y, class: 'fd-arm' }));
  }
  root.append(svg('rect', { x: c - 26, y: c - 34, width: 52, height: 68, rx: 12, class: 'fd-body' }));
  root.append(svg('path', { d: `M${c} ${c - 22} L${c + 9} ${c - 6} L${c - 9} ${c - 6} Z`, class: 'fd-body-arrow' }));

  for (const m of layout.motors) {
    const a = (m.angle * Math.PI) / 180;
    const x = c + Math.sin(a) * armR, y = c - Math.cos(a) * armR;
    const g = svg('g', { class: `fd-motor ${m.cw ? 'is-cw' : 'is-ccw'}${opts.active === m.n ? ' is-active' : ''}`, transform: `translate(${x} ${y})`, 'data-motor': String(m.n) });
    g.append(svg('circle', { r: propR, class: 'fd-prop' }));
    // spin arrow: an arc with an arrowhead, direction by cw
    const r = propR - 7;
    const a0 = m.cw ? -150 : -30, a1 = m.cw ? -30 : -150;
    const p0 = [Math.cos((a0 * Math.PI) / 180) * r, Math.sin((a0 * Math.PI) / 180) * r];
    const p1 = [Math.cos((a1 * Math.PI) / 180) * r, Math.sin((a1 * Math.PI) / 180) * r];
    g.append(svg('path', { d: `M${p0[0]} ${p0[1]} A${r} ${r} 0 0 ${m.cw ? 1 : 0} ${p1[0]} ${p1[1]}`, class: 'fd-spin', 'marker-end': 'url(#fd-arrow)' }));
    g.append(svg('text', { y: 7, class: 'fd-num' }, String(m.n)));
    g.append(svg('text', { y: 24, class: 'fd-letter' }, layout.order.get(m.n) ?? ''));
    const out = opts.outputs?.get(m.n);
    g.append(svg('text', { y: propR + 15, class: 'fd-out' }, out ? `OUT${out} · ${m.cw ? 'CW' : 'CCW'}` : m.cw ? 'CW' : 'CCW'));
    if (opts.onMotor) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `Test motor ${m.n}`);
      g.addEventListener('click', () => opts.onMotor!(m.n));
      g.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') opts.onMotor!(m.n); });
    }
    root.append(g);
  }
  const defs = svg('defs', {});
  const marker = svg('marker', { id: 'fd-arrow', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  marker.append(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'fd-arrowhead' }));
  defs.append(marker);
  root.prepend(defs);
  return root;
}

/** Small generic glyph for a frame class picker (N arms). */
export function frameGlyph(arms: number, x = true): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 64 64', class: 'frame-glyph', 'aria-hidden': 'true' });
  const off = x && arms % 2 === 0 ? 180 / arms : 0;
  for (let i = 0; i < arms; i++) {
    const a = ((i * 360) / arms + off) * (Math.PI / 180);
    const px = 32 + Math.sin(a) * 21, py = 32 - Math.cos(a) * 21;
    root.append(svg('line', { x1: 32, y1: 32, x2: px, y2: py, class: 'fg-arm' }));
    root.append(svg('circle', { cx: px, cy: py, r: arms > 6 ? 6 : 8, class: 'fg-prop' }));
  }
  root.append(svg('circle', { cx: 32, cy: 32, r: 6, class: 'fg-body' }));
  return root;
}
