/** Selected-block controls own their preview; only a completed gesture changes source. */
import type { BlockEdit } from './block-edit';
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
  const controls = new Map<HTMLElement, GestureKind>();
  const button = (label: string, text: string, position: Record<string, string>, kind?: GestureKind) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    Object.assign(b.style, {
      position: 'absolute',
      pointerEvents: 'auto',
      touchAction: 'none',
      width: touch ? '44px' : '28px',
      height: touch ? '44px' : '28px',
      padding: '0',
      border: '1px solid #14b8a6',
      borderRadius: '4px',
      background: 'white',
      color: '#115e59',
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
      ...position,
      ...(touch && position.top === '-28px' ? { top: '-44px' } : {}),
      ...(touch && position.right === '-28px' ? { right: '-44px' } : {}),
      ...(touch && position.bottom === '-28px' ? { bottom: '-44px' } : {}),
    });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (kind) begin(e, kind);
    });
    if (kind) controls.set(b, kind);
    root.append(b);
    return b;
  };
  button('Move selected block', '⠿', { left: '-12px', top: '-28px' }, 'move');
  const remove = button('Delete selected block', '×', {
    right: '-12px',
    top: '-28px',
  });
  button('Resize selected block', '↘', { right: '-28px', bottom: '-28px' }, 'resize');
  button('Resize block width', '↔', { right: '-28px', top: 'calc(50% - 14px)' }, 'width');
  button('Resize block height', '↕', { left: 'calc(50% - 14px)', bottom: '-28px' }, 'height');
  const divider = button('Resize adjacent columns', '↔', { right: '-28px', top: 'calc(50% - 14px)' }, 'divider');
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
    Object.assign(root.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  };
  function start(kind: GestureKind, pointer: number | null, x = 0, y = 0) {
    if (!element || !path) return;
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
    };
  }
  function begin(event: PointerEvent, kind: GestureKind) {
    event.stopPropagation();
    start(kind, event.pointerId, event.clientX, event.clientY);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  const dimensions = (g: Gesture) => ({
    width: Math.max(40, g.width + (g.kind === 'height' ? 0 : g.dx)),
    height: Math.max(20, g.height + (['width', 'divider'].includes(g.kind) ? 0 : g.dy)),
  });
  const preview = () => {
    if (!gesture) return;
    const size = dimensions(gesture);
    Object.assign(root.style, {
      width: `${size.width}px`,
      height: `${size.height}px`,
      outline: '2px dashed #14b8a6',
    });
  };
  const cancel = () => {
    if (!gesture) return false;
    gesture = null;
    root.style.outline = '';
    position();
    return true;
  };
  const finish = (target?: string) => {
    const g = gesture;
    if (!g || !path) return;
    const p = path,
      size = dimensions(g);
    cancel();
    if (!element?.isConnected || (Math.abs(g.dx) + Math.abs(g.dy) < 3 && !g.steps)) return;
    if (g.kind === 'move') {
      if (!target && g.pointer === null) {
        const parts = p.split('.'),
          index = Number(parts.pop());
        target = [...parts, String(index + g.steps)].join('.');
      }
      if (target) commit({ kind: 'move', path: p, target });
      return;
    }
    if (g.kind === 'divider' && grid) {
      commit({
        kind: 'divider',
        path: p,
        width: Math.round((size.width / grid.width) * grid.cols),
      });
      return;
    }
    commit({
      kind: 'resize',
      path: p,
      ...(g.kind === 'width' || g.kind === 'height' ? { axis: g.kind } : {}),
      ...(grid
        ? {
            width: Math.round((size.width / grid.width) * grid.cols),
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
    preview();
  };
  const onUp = (e: PointerEvent) => {
    if (!gesture || gesture.pointer !== e.pointerId) return;
    gesture.dx = e.clientX - gesture.x;
    gesture.dy = e.clientY - gesture.y;
    let target = doc.elementFromPoint(e.clientX, e.clientY)?.closest('[data-mx-ast]');
    // Dropping on text inside the sibling column moves the column itself.
    const depth = path?.split('.').length;
    while (target && target.getAttribute('data-mx-ast')?.split('.').length !== depth)
      target = target.parentElement?.closest('[data-mx-ast]') ?? null;
    finish(target?.getAttribute('data-mx-ast') ?? undefined);
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
    else if (horizontal) gesture.dx += sign * (grid ? grid.width / grid.cols : e.shiftKey ? 40 : 10);
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
          g?.positioned || (kind === 'divider' && !paired) || (kind === 'width' && paired) ? 'none' : 'block';
      divider.style.display = paired ? 'block' : 'none';
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
