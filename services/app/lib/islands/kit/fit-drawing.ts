/** Compatibility layout for old snapshots; current responsive drawings never load this chunk. */
import { DRAWING_CLASS } from '../chart';

const FIT = { position: 'absolute', inset: '0px', width: '100%', height: '100%' } as const;
export function fitDrawing(el: HTMLElement): void {
  const svg = el.firstElementChild;
  if (!(svg instanceof SVGSVGElement) || DRAWING_CLASS.split(' ').every((c) => svg.classList.contains(c))) return;
  const drawn = Number(svg.getAttribute('height'));
  Object.assign(svg.style, FIT);
  const box = el.getBoundingClientRect().height;
  if (box && Number.isFinite(drawn) && Math.abs(box - drawn) > 1) return;
  for (const name of Object.keys(FIT)) svg.style.removeProperty(name);
  if (!svg.getAttribute('style')) svg.removeAttribute('style');
}
