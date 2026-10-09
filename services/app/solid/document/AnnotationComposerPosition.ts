import type { StoryEditSelection } from '@/lib/story-runtime/contract';
import { APP_BAR_H } from '@/lib/story-ui/edit-bar';

export interface ComposerPoint { left: number; top: number }

/** Keep a manually moved composer inside the reachable viewport, accounting for its rendered size. */
export function clampComposerPosition(position: ComposerPoint & { width: number }, viewportWidth: number,
  viewportHeight: number, height: number, minTop: number, inset = 12) {
  const maxLeft = Math.max(inset, viewportWidth - position.width - inset);
  const maxTop = Math.max(minTop, viewportHeight - height - inset);
  return {
    left: Math.max(inset, Math.min(position.left, maxLeft)),
    top: Math.max(minTop, Math.min(position.top, maxTop)),
  };
}

/** Track a single pointer gesture on the move handle; up, cancel and teardown all release listeners. */
export function beginComposerPointerDrag(event: PointerEvent, origin: ComposerPoint,
  onMove: (position: ComposerPoint) => void, handle: HTMLElement, target: Window = window) {
  if (event.button !== 0 || event.isPrimary === false) return () => {};
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY };
  const pointerId = event.pointerId;
  let active = true, captured = false;
  try {
    handle.setPointerCapture(pointerId);
    captured = true;
  } catch { /* Synthetic events and lost pointers may not support capture. */ }
  const move = (next: PointerEvent) => {
    if (!active || next.pointerId !== pointerId) return;
    onMove({ left: origin.left + next.clientX - start.x, top: origin.top + next.clientY - start.y });
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    stop();
  };
  const stop = () => {
    if (!active) return;
    active = false;
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', finish);
    target.removeEventListener('pointercancel', finish);
    target.removeEventListener('blur', stop);
    if (captured) {
      try { handle.releasePointerCapture(pointerId); } catch { /* The browser may already have released it. */ }
      captured = false;
    }
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);
  target.addEventListener('blur', stop);
  return stop;
}

/** Frame-relative selections stay beside their document node and clear the rail. */
export function positionedComposer(selection: StoryEditSelection, frame: Pick<DOMRect, 'left' | 'top' | 'width'>,
  viewportWidth: number, viewportHeight: number, screenshot = false) {
  const inset = 12;
  const narrow = frame.width < 280;
  const minLeft = narrow ? inset : frame.left + inset;
  const maxRight = narrow ? viewportWidth - inset : Math.min(viewportWidth - inset, frame.left + frame.width - inset);
  const width = Math.max(0, Math.min(screenshot ? 680 : 384, maxRight - minLeft));
  const anchorRight = frame.left + selection.rect.x + selection.rect.width;
  const left = Math.max(minLeft, Math.min(anchorRight + 12, maxRight - width));
  const minTop = Math.max(frame.top, screenshot ? APP_BAR_H : 0) + inset;
  const preferredTop = frame.top + selection.rect.y + Math.min(selection.rect.height + 12, 56);
  const maxTop = Math.max(minTop, viewportHeight - (screenshot ? 720 : 236) - inset);
  return { left, top: Math.max(minTop, Math.min(preferredTop, maxTop)), width };
}
