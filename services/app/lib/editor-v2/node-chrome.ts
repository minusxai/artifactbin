/** Selected-block controls own their preview; only a completed gesture changes source. */
import type { BlockEdit } from './block-edit';
import { createDragPreview } from './drag-preview';
import { SELECTION_PRESENTATION } from '../story-runtime/selection-presentation';
interface GridGeometry {
  cols: number;
  rowHeight: number;
  width: number;
  positioned: boolean;
}
export interface NodeChrome {
  /**
   * `resizable: false` keeps move and delete but offers no resize control (the
   * block cannot take one). `label`/`parent` name the block and its parent for
   * the drag label.
   */
  select(
    element: HTMLElement | null,
    path: string | null,
    grid?: GridGeometry,
    options?: { resizable?: boolean; label?: string; parent?: string },
  ): void;
  /** The block under the pointer gets a faint grip in its left margin; null hides it. */
  hover(element: HTMLElement | null): void;
  cancel(): boolean;
  dispose(): void;
}
/** The margin grip lives outside the selected-block overlay: it is shown for a block that is NOT selected. */
export const HOVER_GRIP_ATTR = 'data-mx-hover-grip';
/** Every element this module draws. Pointer and click handlers treat them as chrome, never as document. */
export const NODE_CHROME_SELECTOR = `[data-mx-node-chrome], [${HOVER_GRIP_ATTR}]`;
const P = SELECTION_PRESENTATION;
/**
 * Handle colours live in a sheet, not inline, so they can darken on :hover and
 * ring on :focus-visible. Neutral translucent grey reads on light and dark
 * grounds, so no handle paints a background of its own.
 */
const HANDLE_CSS = [
  `:is([data-mx-node-chrome], [${HOVER_GRIP_ATTR}])[data-mx-chrome-root] > button > span { color: ${P.handleColor}; }`,
  `:is([data-mx-node-chrome], [${HOVER_GRIP_ATTR}])[data-mx-chrome-root] > button[data-mx-dot] > span { background: ${P.handleDot}; }`,
  `:is([data-mx-node-chrome], [${HOVER_GRIP_ATTR}])[data-mx-chrome-root] > button:hover > span { color: ${P.handleActive}; }`,
  `:is([data-mx-node-chrome], [${HOVER_GRIP_ATTR}])[data-mx-chrome-root] > button[data-mx-dot]:hover > span { background: ${P.handleActive}; }`,
  `:is([data-mx-node-chrome], [${HOVER_GRIP_ATTR}])[data-mx-chrome-root] > button:focus-visible { outline: 2px solid ${P.handleActive}; outline-offset: -2px; }`,
].join('\n');
type GestureKind = 'move' | 'resize' | 'width' | 'height' | 'divider';
interface Gesture {
  kind: GestureKind;
  pointer: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
  steps: number;
  pairTotal?: number;
}
export function createNodeChrome(
  doc: Document,
  commit: (command: BlockEdit) => void,
  /** Pressing the margin grip asks the owner to select that block, then drags it like the selected grip. */
  grab?: (element: HTMLElement) => void,
): NodeChrome {
  const root = doc.createElement('div');
  root.setAttribute('data-mx-node-chrome', '');
  root.setAttribute('data-mx-chrome-root', '');
  Object.assign(root.style, {
    position: 'fixed',
    zIndex: '45',
    pointerEvents: 'none',
    display: 'none',
  });
  const touch = doc.defaultView?.matchMedia?.('(pointer: coarse)').matches;
  doc.body.append(root);
  let element: HTMLElement | null = null,
    path: string | null = null,
    grid: GridGeometry | undefined;
  let gesture: Gesture | null = null;
  const dragPreview = createDragPreview(doc);
  const previewStyle = doc.createElement('style');
  const previewId = crypto.randomUUID();
  doc.head.append(previewStyle);
  const handleStyle = doc.createElement('style');
  handleStyle.textContent = HANDLE_CSS;
  doc.head.append(handleStyle);
  let previewElement: HTMLElement | null = null;
  let previewPeer: HTMLElement | null = null;
  let frame = 0;
  let settling = 0;
  const clearPreview = () => {
    doc.defaultView?.cancelAnimationFrame(settling);
    settling = 0;
    previewElement?.removeAttribute('data-mx-resize-preview');
    previewPeer?.removeAttribute('data-mx-resize-peer');
    previewElement = previewPeer = null;
    previewStyle.textContent = '';
  };
  const gap = () =>
    Number.parseFloat(
      element?.parentElement ? doc.defaultView!.getComputedStyle(element.parentElement).columnGap : '',
    ) || 0;
  const unit = () => (grid ? (grid.width + gap()) / grid.cols : 1);
  const span = (width: number) =>
    grid ? Math.max(1, Math.min(grid.cols, Math.round((width + gap()) / unit()))) : 1;

  const controls = new Map<HTMLElement, GestureKind>();
  const button = (label: string, text: string, position: Record<string, string>, kind?: GestureKind) => {
    const b = doc.createElement('button');
    b.type = 'button';
    const dot = doc.createElement('span');
    dot.textContent = text;
    dot.setAttribute('aria-hidden', 'true');
    const isDot = !!kind && kind !== 'move';
    Object.assign(dot.style, {
      display: 'grid',
      placeItems: 'center',
      width: isDot ? '7px' : '18px',
      height: isDot ? '7px' : '18px',
      borderRadius: '50%',
      font: kind === 'move' ? '12px system-ui' : '16px/1 system-ui',
      pointerEvents: 'none',
    });
    if (isDot) b.setAttribute('data-mx-dot', '');
    b.append(dot);
    b.setAttribute('aria-label', label);
    Object.assign(b.style, {
      position: 'absolute',
      pointerEvents: 'auto',
      touchAction: 'none',
      width: touch ? '44px' : '28px',
      height: touch ? '44px' : '28px',
      padding: '0',
      border: '0',
      borderRadius: '50%',
      background: 'transparent',
      display: 'grid',
      placeItems: 'center',
      font: '16px system-ui',
      cursor:
        kind === 'move'
          ? 'grab'
          : kind === 'width' || kind === 'divider'
            ? 'ew-resize'
            : kind === 'height'
              ? 'ns-resize'
              : kind === 'resize'
                ? 'nwse-resize'
                : 'pointer',
      transform: 'translate(-50%, -50%)',
      ...position,
    });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (kind) begin(e, kind);
    });
    if (kind) controls.set(b, kind);
    root.append(b);
    return b;
  };
  // Center every hit-target size on the shared selection outline.
  const near = `${-SELECTION_PRESENTATION.handleOutset}px`;
  const far = `calc(100% + ${SELECTION_PRESENTATION.handleOutset}px)`;
  const moveButton = button('Move selected block', '⠿', { left: near, top: near }, 'move');
  const remove = button('Delete selected block', '', { left: far, top: near });
  const trash = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24', width: '12', height: '12', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  })) trash.setAttribute(name, value);
  for (const d of ['M3 6h18', 'M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6', 'M9 6V3h6v3', 'M10 10v7', 'M14 10v7']) {
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', d);
    trash.append(line);
  }
  remove.firstElementChild!.append(trash);
  button('Resize selected block', '', { left: far, top: far }, 'resize');
  button('Resize block width', '', { left: far, top: '50%' }, 'width');
  button('Resize block height', '', { left: '50%', top: far }, 'height');
  const divider = button('Resize adjacent columns', '', { left: far, top: '50%' }, 'divider');
  // The margin grip: the same glyph and drag as the selected grip, offered
  // beside whatever block the pointer is on, so a block can be picked up
  // without first being selected. Its hit area abuts the block's left edge so
  // the pointer can travel onto it without crossing another block. A finger
  // needs 44px; the glyph stays small inside that invisible target.
  const GRIP = touch ? 44 : 24;
  /**
   * Outside the block's left edge when there is room (the viewport edge, or a
   * block beside it in the same row, bounds that room); just inside it when
   * there is not — a phone's narrow margin, a right-hand column.
   */
  const gripOutside = (el: HTMLElement, r: DOMRect) => {
    let bound = 0;
    for (let prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
      const p = prev.getBoundingClientRect();
      if (p.bottom > r.top && p.top < r.bottom && p.right <= r.left) {
        bound = Math.max(bound, p.right);
        break;
      }
    }
    return r.left - bound >= GRIP;
  };
  const gripRoot = doc.createElement('div');
  gripRoot.setAttribute(HOVER_GRIP_ATTR, '');
  gripRoot.setAttribute('data-mx-chrome-root', '');
  Object.assign(gripRoot.style, { position: 'fixed', zIndex: '45', pointerEvents: 'none', display: 'none' });
  const gripButton = doc.createElement('button');
  gripButton.type = 'button';
  gripButton.tabIndex = -1; // pointer affordance; the selected block's grip is the keyboard path
  gripButton.setAttribute('aria-label', 'Drag block');
  Object.assign(gripButton.style, {
    width: `${GRIP}px`,
    height: `${GRIP}px`,
    padding: '0',
    border: '0',
    borderRadius: '4px',
    background: 'transparent',
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'auto',
    touchAction: 'none',
    cursor: 'grab',
  });
  const gripGlyph = doc.createElement('span');
  gripGlyph.textContent = '⠿';
  gripGlyph.setAttribute('aria-hidden', 'true');
  Object.assign(gripGlyph.style, { font: '12px system-ui', pointerEvents: 'none' });
  gripButton.append(gripGlyph);
  gripRoot.append(gripButton);
  doc.body.append(gripRoot);
  let hovered: HTMLElement | null = null;
  let labels = { label: 'Block', parent: 'container' };
  // One grip at a time: while a block is selected its own grip is the grip.
  const placeGrip = () => {
    const target = hovered;
    if (!target?.isConnected || element || gesture) {
      gripRoot.style.display = 'none';
      return;
    }
    const r = target.getBoundingClientRect();
    Object.assign(gripRoot.style, {
      display: 'block',
      left: `${gripOutside(target, r) ? r.left - GRIP : r.left}px`,
      top: `${r.top}px`,
    });
  };
  gripButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const target = hovered;
    if (!target || !grab) return;
    grab(target);
    if (element === target && path && moveButton.style.display !== 'none') begin(e, 'move');
  });
  remove.addEventListener('click', () => {
    if (path) {
      const p = path;
      cancel();
      commit({ kind: 'delete', paths: [p] });
    }
  });
  const position = () => {
    placeGrip();
    if (!element?.isConnected) {
      root.style.display = 'none';
      return;
    }
    const r = element.getBoundingClientRect();
    const size = gesture && gesture.kind !== 'move' ? dimensions(gesture) : r;
    Object.assign(root.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${grid ? r.width : size.width}px`,
      height: `${Math.max(size.height, r.height)}px`,
    });
    // Corners and edge midpoints share each axis. Fit hit areas within
    // their center spacing so short prose cannot put resize over delete.
    const targetSize = touch ? 44 : 28;
    const width = grid ? r.width : size.width;
    const height = Math.max(size.height, r.height);
    for (const button of [...controls.keys(), remove]) {
      if (button === moveButton) continue;
      button.style.width = `${Math.min(targetSize, width / 2 + SELECTION_PRESENTATION.handleOutset)}px`;
      button.style.height = `${Math.min(targetSize, height / 2 + SELECTION_PRESENTATION.handleOutset)}px`;
    }
    // The selected block's grip sits where the margin grip did.
    Object.assign(moveButton.style, {
      width: `${GRIP}px`,
      height: `${GRIP}px`,
      left: `${gripOutside(element, r) ? -GRIP / 2 : GRIP / 2}px`,
      top: `${GRIP / 2}px`,
    });
    if (gesture?.kind === 'move') moveDestination();
  };
  function start(kind: GestureKind, pointer: number | null, x = 0, y = 0) {
    if (!element || !path) return;
    clearPreview();
    const r = element.getBoundingClientRect();
    gesture = {
      kind,
      pointer,
      x,
      y,
      width: r.width,
      height: r.height,
      dx: 0,
      dy: 0,
      steps: 0,
      pairTotal:
        kind === 'divider' && element.nextElementSibling
          ? span(r.width) + span(element.nextElementSibling.getBoundingClientRect().width)
          : undefined,
    };
    if (kind === 'move') {
      dragPreview.start(element, path, labels);
      preview();
    }
  }
  function begin(event: PointerEvent, kind: GestureKind) {
    event.stopPropagation();
    start(kind, event.pointerId, event.clientX, event.clientY);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  const dimensions = (g: Gesture) => ({
    width: Math.min(
      element?.parentElement?.getBoundingClientRect().width || 4000,
      Math.max(40, g.width + (g.kind === 'height' ? 0 : g.dx)),
    ),
    height: Math.max(20, g.height + (['width', 'divider'].includes(g.kind) ? 0 : g.dy)),
  });
  const preview = () => {
    if (!gesture || !element) return;
    if (gesture.kind === 'move') {
      moveDestination();
      return;
    }
    const size = dimensions(gesture);
    previewElement = element;
    element.setAttribute('data-mx-resize-preview', previewId);
    // Authored utility classes are important too; the scoped preview must win
    // without changing the element's authored style attribute.
    const selector = `[data-mx-resize-preview="${previewId}"][data-mx-resize-preview]`;
    const rules: string[] = [];
    if (gesture.kind !== 'height') {
      if (grid) {
        let width = span(size.width);
        if (gesture.kind === 'divider' && element.nextElementSibling instanceof HTMLElement) {
          previewPeer = element.nextElementSibling;
          previewPeer.setAttribute('data-mx-resize-peer', previewId);
          const total = gesture.pairTotal!;
          width = Math.min(width, total - 1);
          rules.push(
            `[data-mx-resize-peer="${previewId}"][data-mx-resize-peer] { grid-column: span ${total - width} !important; }`,
          );
        }
        rules.push(`${selector} { grid-column: span ${width} !important; }`);
      } else rules.push(`${selector} { width: ${size.width}px !important; max-width: 100% !important; }`);
    }
    if (!['width', 'divider'].includes(gesture.kind))
      rules.push(`${selector} { min-height: ${size.height}px !important; height: auto !important; }`);
    previewStyle.textContent = rules.join('\n');
    position();
    root.style.outline = '1px solid rgba(100,116,139,.3)';
  };
  // Retain the preview through the source/CSS acknowledgement, then remove it
  // before paint once authored geometry matches. No preview enters source.
  const settlePreview = () => {
    const started = Date.now();
    const check = () => {
      if (!previewElement?.isConnected || !previewStyle.sheet) {
        clearPreview();
        position();
        return;
      }
      const preview = previewElement.getBoundingClientRect();
      previewStyle.sheet.disabled = true;
      const authored = previewElement.getBoundingClientRect();
      previewStyle.sheet.disabled = false;
      if (
        (Math.abs(preview.width - authored.width) < 1 && Math.abs(preview.height - authored.height) < 1) ||
        Date.now() - started > 1500
      ) {
        clearPreview();
        position();
      } else settling = doc.defaultView!.requestAnimationFrame(check);
    };
    settling = doc.defaultView!.requestAnimationFrame(check);
  };
  const cancel = () => {
    if (!gesture) return false;
    gesture = null;
    doc.defaultView?.cancelAnimationFrame(frame);
    clearPreview();
    dragPreview.clear();
    root.style.outline = '';
    position();
    return true;
  };
  const moveDestination = () => {
    if (!gesture || !element || !path) return;
    const parts = path.split('.'), index = Number(parts.pop());
    const r = element.getBoundingClientRect();
    return gesture.pointer === null
      ? dragPreview.update(r.left, r.top, [...parts, String(index + gesture.steps)].join('.'))
      : dragPreview.update(gesture.x + gesture.dx, gesture.y + gesture.dy);
  };
  const finish = () => {
    const g = gesture;
    if (!g || !path) return;
    const p = path,
      size = dimensions(g);
    if (!element?.isConnected || (Math.abs(g.dx) + Math.abs(g.dy) < 3 && !g.steps)) {
      cancel();
      return;
    }
    preview();
    const target = g.kind === 'move' ? moveDestination() : undefined;
    gesture = null;
    doc.defaultView?.cancelAnimationFrame(frame);
    root.style.outline = '';
    settlePreview();
    if (g.kind === 'move') {
      dragPreview.clear();
      if (target) commit({ kind: 'move', path: p, target });
      return;
    }
    if (g.kind === 'divider' && grid) {
      commit({
        kind: 'divider',
        path: p,
        width: span(size.width),
      });
      return;
    }
    commit({
      kind: 'resize',
      path: p,
      ...(g.kind === 'width' || g.kind === 'height' ? { axis: g.kind } : {}),
      ...(grid
        ? {
            width: span(size.width),
            height: grid.positioned ? Math.round(size.height / grid.rowHeight) : size.height,
            grid: true,
          }
        : size),
    });
  };
  const onMove = (e: PointerEvent) => {
    if (!gesture || gesture.pointer !== e.pointerId) return;
    gesture.dx = e.clientX - gesture.x;
    gesture.dy = e.clientY - gesture.y;
    doc.defaultView?.cancelAnimationFrame(frame);
    frame = doc.defaultView!.requestAnimationFrame(preview);
  };
  const onUp = (e: PointerEvent) => {
    if (!gesture || gesture.pointer !== e.pointerId) return;
    gesture.dx = e.clientX - gesture.x;
    gesture.dy = e.clientY - gesture.y;
    finish();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && cancel()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const kind = controls.get(e.target as HTMLElement);
    if (!kind || !element || !path) return;
    if (e.key === 'Enter' && gesture) {
      e.preventDefault();
      finish();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!gesture) start(kind, null);
    if (!gesture) return;
    const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight',
      sign = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    if (kind === 'move') gesture.steps += sign;
    else if (horizontal) gesture.dx += sign * (grid ? unit() : e.shiftKey ? 40 : 10);
    else gesture.dy += sign * (grid?.positioned ? grid.rowHeight : e.shiftKey ? 40 : 10);
    preview();
  };
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', onUp, true);
  doc.addEventListener('pointercancel', cancel, true);
  doc.addEventListener('keydown', onKey, true);
  doc.defaultView?.addEventListener('scroll', position, true);
  doc.defaultView?.addEventListener('resize', position);
  return {
    select(el, p, g, options) {
      if (gesture) return;
      const resizable = options?.resizable ?? true;
      labels = { label: options?.label ?? 'Block', parent: options?.parent ?? 'container' };
      if (settling && el && p === path && previewElement !== el) {
        previewElement?.removeAttribute('data-mx-resize-preview');
        previewElement = el;
        el.setAttribute('data-mx-resize-preview', previewId);
      }
      element = el;
      path = p;
      grid = g;
      root.style.display = el ? 'block' : 'none';
      const next = el?.nextElementSibling;
      const paired =
        !!g &&
        !g.positioned &&
        !!next &&
        Math.abs(next.getBoundingClientRect().top - el!.getBoundingClientRect().top) < 3;
      for (const [button, kind] of controls)
        button.style.display =
          g?.positioned || (kind === 'divider' && !paired) || (kind === 'width' && paired) || (!resizable && kind !== 'move')
            ? 'none'
            : 'grid';
      divider.style.display = paired && resizable ? 'grid' : 'none';
      for (const b of root.querySelectorAll('button'))
        b.setAttribute(
          'aria-description',
          `${el?.tagName.toLowerCase() ?? 'block'}: ${el?.textContent?.trim().slice(0, 80) ?? ''}. Arrow keys adjust; Enter commits; Escape cancels.`,
        );
      position();
    },
    hover(el) {
      hovered = el;
      placeGrip();
    },
    cancel,
    dispose() {
      cancel();
      clearPreview();
      dragPreview.dispose();
      previewStyle.remove();
      handleStyle.remove();
      root.remove();
      gripRoot.remove();
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', cancel, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.defaultView?.removeEventListener('scroll', position, true);
      doc.defaultView?.removeEventListener('resize', position);
    },
  };
}
