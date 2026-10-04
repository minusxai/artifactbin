/**
 * The hand: three unrelated subjects (an object, a place, a quantity) and a screen pair drawn in a
 * system's drawing style. A spec's `hand` picks a mode; the geometry is shared so the reader sees the
 * technique, not the subject.
 *
 * hand = { mode: 'flat'|'outline'|'hatch'|'engrave'|'pixel'|'glow'|'riso', shadow: bool, rules, headline, note }
 * Classes the system styles (defaults in the page kit): h-ink h-fill h-fill2 h-muted h-ground h-tex h-text h-num h-glow h-plate h-shadow
 */
import { pyRound, pyFloat } from './py.mjs';

const snap = (v, g = 8) => Math.trunc(pyRound(v / g) * g);
const attrs = (d) => Object.entries(d).map(([k, v]) => `${k}="${v}"`).join(' ');

class Scene {
  constructor(pixel = false) { this.items = []; this.pixel = pixel; }
  rect(role, x, y, w, h, rx = 0) {
    if (this.pixel) { x = snap(x); y = snap(y); w = Math.max(8, snap(w)); h = Math.max(8, snap(h)); rx = 0; }
    const a = { x, y, width: w, height: h };
    if (rx) a.rx = rx;
    this.items.push([role, 'rect', a]);
  }
  circle(role, cx, cy, r) {
    if (this.pixel) { this.rect(role, cx - r, cy - r, 2 * r, 2 * r); return; }
    this.items.push([role, 'circle', { cx, cy, r }]);
  }
  line(role, x1, y1, x2, y2) {
    if (this.pixel) { x1 = snap(x1); y1 = snap(y1); x2 = snap(x2); y2 = snap(y2); }
    this.items.push([role, 'line', { x1, y1, x2, y2 }]);
  }
  text(role, x, y, s, anchor = 'start') {
    const a = { x, y };
    if (anchor !== 'start') a.textAnchor = anchor;
    this.items.push([role, 'text', { ...a, _s: s }]);
  }
}

export function phone(sc) {
  sc.rect('shadow', 180, 16, 120, 208, 18);
  sc.rect('ground', 180, 16, 120, 208, 18);
  sc.rect('ink', 180, 16, 120, 208, 18);
  sc.rect('muted', 192, 36, 96, 160, 8);
  sc.rect('ink', 192, 36, 96, 160, 8);
  sc.line('ink', 224, 27, 256, 27);
  sc.rect('fill', 200, 44, 80, 40, 4);
  sc.text('num', 240, 150, '60', 'middle');
  sc.text('text', 240, 176, 'OF 100 KEPT', 'middle');
  sc.circle('ink', 240, 210, 6);
  sc.rect('fill2', 328, 40, 72, 26, 4);
  sc.rect('ink', 328, 40, 72, 26, 4);
  sc.text('text', 364, 57, 'UNIT 001', 'middle');
  sc.line('ink', 300, 60, 328, 53);
}

export function building(sc) {
  sc.rect('shadow', 96, 56, 288, 154);
  sc.rect('ground', 96, 56, 288, 154);
  sc.rect('ink', 96, 56, 288, 154);
  sc.rect('fill', 88, 40, 304, 18);
  sc.rect('ink', 88, 40, 304, 18);
  sc.text('text', 240, 53, 'OPEN LATE · THURSDAYS', 'middle');
  const lit = new Set(['0,0', '2,1', '4,0', '1,2', '3,2', '4,2']);
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 5; i++) {
      const x = 120 + i * 52, y = 76 + j * 28;
      sc.rect(lit.has(`${i},${j}`) ? 'fill2' : 'muted', x, y, 32, 18);
      sc.rect('ink', x, y, 32, 18);
    }
  }
  sc.rect('ink', 226, 164, 28, 46);
  sc.circle('ink', 248, 188, 2);
  sc.line('ink', 24, 210, 456, 210);
  sc.circle('fill', 424, 30, 10);
  sc.text('text', 24, 232, '6 OF 15 WINDOWS LIT', 'start');
}

export function units(sc) {
  for (let n = 0; n < 100; n++) {
    const i = n % 10, j = Math.floor(n / 10);
    const role = n < 60 ? 'fill' : n < 85 ? 'fill2' : 'muted';
    sc.rect(role, 24 + i * 22, 24 + j * 20, 16, 14, 3);
    sc.rect('ink', 24 + i * 22, 24 + j * 20, 16, 14, 3);
  }
  sc.text('num', 280, 92, '100', 'start');
  sc.text('text', 280, 114, 'UNITS, ONE BATCH', 'start');
  for (const [role, lab, y] of [['fill', '60 · KEPT', 150], ['fill2', '25 · PARTS', 174], ['muted', '15 · RECYCLED', 198]]) {
    sc.rect(role, 280, y - 11, 14, 14, 3);
    sc.rect('ink', 280, y - 11, 14, 14, 3);
    sc.text('text', 304, y, lab, 'start');
  }
}

/** A desktop screen wireframe: top bar, side rail, a stat row, a chart block and a primary action. */
export function screen(sc) {
  sc.rect('shadow', 24, 8, 432, 204, 6);
  sc.rect('ground', 24, 8, 432, 204, 6);
  sc.rect('ink', 24, 8, 432, 204, 6);
  sc.line('ink', 24, 36, 456, 36);
  sc.rect('muted', 36, 18, 56, 8, 2);
  sc.rect('fill', 392, 16, 52, 12, 3);
  sc.line('ink', 112, 36, 112, 212);
  for (const y of [52, 72, 92, 112]) sc.rect('muted', 36, y, 56, 8, 2);
  sc.rect('fill2', 36, 52, 56, 8, 2);
  for (let i = 0; i < 3; i++) {
    const x = 128 + i * 108;
    sc.rect('ink', x, 50, 96, 44, 3);
    sc.rect('muted', x + 8, 58, 40, 6, 2);
    sc.rect('muted', x + 8, 72, 60, 12, 2);
  }
  sc.rect('ink', 128, 106, 204, 92, 3);
  [20, 34, 28, 48, 40, 60, 54, 70].forEach((h, i) => sc.rect(i === 7 ? 'fill2' : 'muted', 140 + i * 24, 190 - h, 14, h, 2));
  sc.rect('ink', 344, 106, 96, 92, 3);
  for (let j = 0; j < 5; j++) sc.rect('muted', 352, 116 + j * 16, 80, 6, 2);
  sc.text('text', 24, 234, 'S1 · DESKTOP · OVERVIEW', 'start');
}

/** A phone screen wireframe: header, stat, list rows and a bottom action. */
export function screenMobile(sc) {
  sc.rect('shadow', 170, 8, 140, 224, 10);
  sc.rect('ground', 170, 8, 140, 224, 10);
  sc.rect('ink', 170, 8, 140, 224, 10);
  sc.line('ink', 170, 36, 310, 36);
  sc.rect('muted', 182, 18, 48, 8, 2);
  sc.rect('ink', 182, 48, 116, 40, 3);
  sc.rect('muted', 190, 56, 36, 6, 2);
  sc.rect('muted', 190, 68, 60, 12, 2);
  for (let j = 0; j < 4; j++) {
    const y = 100 + j * 24;
    sc.line('ink', 182, y + 18, 298, y + 18);
    sc.rect('muted', 182, y + 2, 64, 8, 2);
    sc.rect(j === 1 ? 'fill2' : 'muted', 270, y + 2, 28, 8, 2);
  }
  sc.rect('fill', 182, 200, 116, 20, 4);
  sc.text('text', 322, 32, 'S1 · MOBILE', 'start');
  sc.text('text', 322, 56, 'HEADER, STAT,', 'start');
  sc.text('text', 322, 72, 'ROWS, BOTTOM', 'start');
  sc.text('text', 322, 88, 'ACTION', 'start');
}

export const SUBJECTS = [['phone', 'An object', phone], ['building', 'A place', building], ['units', 'A quantity', units], ['screen', 'A screen', screen]];
const HATCH = { hatch: [45, 6], engrave: [0, 4] };

export function render(spec, which, fn) {
  const hand = spec.hand ?? {};
  const mode = hand.mode ?? 'flat';
  const pixel = mode === 'pixel';
  const sc = new Scene(pixel);
  fn(sc);
  const slug = spec.slug;
  const out = [], defs = [];
  const el = (kind, a, cls, extra = '') => {
    const { _s, ...rest } = a;
    if (kind === 'text') return `<text className="${cls}" ${attrs(rest)}${extra}>${_s}</text>`;
    return `<${kind} className="${cls}" ${attrs(rest)}${extra}/>`;
  };
  // 1. hard shadow copy (shadow=true)
  if (hand.shadow) {
    for (const [role, kind, a] of sc.items) {
      if (role === 'shadow') out.push(el(kind, { ...a, x: a.x + 6, y: a.y + 6 }, 'h-shadow'));
    }
  }
  // 2. grounds
  for (const [role, kind, a] of sc.items) if (role === 'ground') out.push(el(kind, a, 'h-ground'));
  // 3. fills: flat / riso plate (offset, multiply) / hatch or engrave screens (clip the fill shape)
  const fills = sc.items.filter(([r]) => r === 'fill' || r === 'fill2' || r === 'muted');
  if (mode in HATCH) {
    const [ang, pitch] = HATCH[mode];
    let n = 0;
    for (const [role, kind, a] of fills) {
      if (kind !== 'rect') { out.push(el(kind, a, `h-${role}`)); continue; }
      n += 1;
      const cid = `${slug}-${which}-h${n}`;
      defs.push(`<clipPath id="${cid}"><rect ${attrs(a)}/></clipPath>`);
      const { x, y, width: w, height: h } = a;
      const lines = [];
      if (ang === 45) {
        let k = Math.trunc(-h) - pitch;
        while (k < w + h) { lines.push(`<line x1="${x + k}" y1="${y + h}" x2="${x + k + h}" y2="${y}"/>`); k += pitch; }
      } else {
        // Python walked these in floats (`y + pitch / 2`), so the coordinates print as `79.0`.
        let yy = y + pitch / 2;
        while (yy < y + h) { lines.push(`<line x1="${x}" y1="${pyFloat(yy)}" x2="${x + w}" y2="${pyFloat(yy)}"/>`); yy += pitch; }
      }
      // muted stays a flat quiet fill so the three classes still read
      if (role === 'muted') out.push(el(kind, a, 'h-muted'));
      else out.push(`<g clipPath="url(#${cid})" className="h-tex h-tex-${role}">${lines.join('')}</g>`);
    }
  } else if (mode === 'riso') {
    const plate = fills.map(([role, kind, a]) => el(kind, a, `h-${role}`)).join('');
    out.push(`<g className="h-plate" transform="translate(4 3)">${plate}</g>`);
  } else if (mode === 'outline') {
    for (const [role, kind, a] of fills) if (role === 'muted') out.push(el(kind, a, 'h-muted'));
  } else {
    for (const [role, kind, a] of fills) out.push(el(kind, a, `h-${role}`));
  }
  // 4. ink (glow mode draws a wide soft copy first)
  const inks = sc.items.filter(([r]) => r === 'ink');
  if (mode === 'glow') out.push('<g className="h-glow">' + inks.map(([, k, a]) => el(k, a, 'h-ink')).join('') + '</g>');
  for (const [, k, a] of inks) out.push(el(k, a, 'h-ink'));
  if (mode === 'outline') {
    for (const [role, kind, a] of fills) if (role !== 'muted') out.push(el(kind, a, `h-${role} h-outline-fill`));
  }
  // 5. text
  for (const [r, k, a] of sc.items) if (r === 'text' || r === 'num') out.push(el(k, a, `h-${r}`));
  const sr = pixel ? ' shapeRendering="crispEdges"' : '';
  const d = defs.length ? `<defs>${defs.join('')}</defs>` : '';
  return `<svg viewBox="0 0 480 240"${sr}><title>${which} drawn in the ${spec.name} hand</title>${d}${out.join('')}</svg>`;
}

export const handPanels = (spec) => SUBJECTS.map(([key, title, fn]) => [title, render(spec, key, fn)]);
