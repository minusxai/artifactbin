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
  select(element: HTMLElement | null, path: string | null, grid?: GridGeometry): void;
  cancel(): boolean;
  dispose(): void;
}
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
export function createNodeChrome(doc: Document, commit: (command: BlockEdit) => void): NodeChrome {
  const root = doc.createElement('div');
  root.setAttribute('data-mx-node-chrome', '');
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
    Object.assign(dot.style, {
      display: 'grid',
      placeItems: 'center',
      width: kind && kind !== 'move' ? '9px' : '18px',
      height: kind && kind !== 'move' ? '9px' : '18px',
      borderRadius: '50%',
      border: '1px solid rgba(100,116,139,.4)',
      background: 'white',
      color: '#64748b',
      boxShadow: '0 1px 3px rgba(15,23,42,.08)',
      font: kind === 'move' ? '12px system-ui' : '16px/1 system-ui',
      pointerEvents: 'none',
    });
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
  button('Move selected block', '⠿', { left: near, top: near }, 'move');
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
  remove.addEventListener('click', () => {
    if (path) {
      const p = path;
      cancel();
      commit({ kind: 'delete', paths: [p] });
    }
  });
  const position = () => {
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
      dragPreview.start(element, path);
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
    select(el, p, g) {
      if (gesture) return;
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
          g?.positioned || (kind === 'divider' && !paired) || (kind === 'width' && paired) ? 'none' : 'grid';
      divider.style.display = paired ? 'grid' : 'none';
      for (const b of root.querySelectorAll('button'))
        b.setAttribute(
          'aria-description',
          `${el?.tagName.toLowerCase() ?? 'block'}: ${el?.textContent?.trim().slice(0, 80) ?? ''}. Arrow keys adjust; Enter commits; Escape cancels.`,
        );
      position();
    },
    cancel,
    dispose() {
      cancel();
      clearPreview();
      dragPreview.dispose();
      previewStyle.remove();
      root.remove();
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', cancel, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.defaultView?.removeEventListener('scroll', position, true);
      doc.defaultView?.removeEventListener('resize', position);
    },
  };
}
