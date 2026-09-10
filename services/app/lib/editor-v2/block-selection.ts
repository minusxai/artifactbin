/** Explicit fallback for ranges crossing independent editor/component boundaries. */
import type { BlockEdit } from './block-edit';
const BLOCK =
  'p[data-mx-ast],h1[data-mx-ast],h2[data-mx-ast],h3[data-mx-ast],h4[data-mx-ast],h5[data-mx-ast],h6[data-mx-ast],li[data-mx-ast],pre[data-mx-ast]';
export function createBlockSelection(
  doc: Document,
  scope: HTMLElement | Document,
  commit: (edit: BlockEdit) => void,
) {
  let selected: Element[] = [];
  let anchor: Element | null = null;
  let pointerAnchor: { node: Node; offset: number } | null = null;
  const suspended = new Map<HTMLElement, string | null>();
  let pointerRestoreFrame = 0;
  const pointAt = (x: number, y: number) => {
    const caret = doc.caretPositionFromPoint?.(x, y);
    if (caret) return { node: caret.offsetNode, offset: caret.offset };
    const range = doc.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  };
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('data-mx-block-status', '');
  Object.assign(status.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - 48px)',
    font: '12px/1.5 system-ui',
    boxShadow: '0 2px 12px rgba(15,23,42,.06)',
    zIndex: '46',
    background: 'rgba(255,255,255,.96)',
    color: '#64748b',
    padding: '7px 12px',
    border: '1px solid rgba(100,116,139,.15)',
    borderRadius: '20px',
    display: 'none',
  });
  doc.body.append(status);
  const paths = () => selected.map((el) => el.getAttribute('data-mx-ast')!).filter(Boolean);
  const clear = () => {
    doc.defaultView?.cancelAnimationFrame(pointerRestoreFrame);
    selected.forEach((el) => el.removeAttribute('data-mx-block-selected'));
    selected = [];
    for (const [root, editable] of suspended) {
      if (editable === null) root.removeAttribute('contenteditable');
      else root.setAttribute('contenteditable', editable);
    }
    suspended.clear();
    status.style.display = 'none';
  };
  const block = (node: Node | null): Element | null =>
    (node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest(BLOCK) ?? null;
  const across = (a: Element | null, b: Element | null) => {
    if (!a || !b || a.closest('.ProseMirror') === b.closest('.ProseMirror')) return;
    const blocks = [...scope.querySelectorAll(BLOCK)].filter((el) => !el.parentElement?.closest(BLOCK));
    const from = blocks.indexOf(a),
      to = blocks.indexOf(b);
    if (from < 0 || to < 0) return;
    const next = blocks.slice(Math.min(from, to), Math.max(from, to) + 1);
    if (next.length === selected.length && next.every((el, i) => el === selected[i])) return;
    selected.forEach((el) => el.removeAttribute('data-mx-block-selected'));
    selected = next;
    // Native selection clips across separate contenteditable hosts. Temporarily
    // make the regions read-only while this block range owns input. The same
    // mounted engines resume on the next caret placement; no source is changed.
    for (const root of scope.querySelectorAll<HTMLElement>('.ProseMirror')) {
      if (!suspended.has(root)) suspended.set(root, root.getAttribute('contenteditable'));
      root.setAttribute('contenteditable', 'false');
    }
    selected.forEach((el) => el.setAttribute('data-mx-block-selected', ''));
    status.textContent = `${selected.length} blocks · Delete to remove · Esc to cancel. Text replacement is unavailable across regions.`;
    status.style.display = 'block';
  };
  const onSelection = () => {
    const range = doc.defaultView?.getSelection();
    if (!range || range.isCollapsed) return;
    across(block(range.anchorNode), block(range.focusNode));
  };
  const onDown = (e: PointerEvent) => {
    if (!scope.contains(e.target as Node) || (e.target as Element)?.closest?.('[data-mx-node-chrome]'))
      return;
    clear();
    anchor = block(e.target as Node);
    pointerAnchor = anchor ? pointAt(e.clientX, e.clientY) : null;
  };
  const extendPointer = (e: PointerEvent) => {
    if (!anchor || !pointerAnchor) return;
    const end = pointAt(e.clientX, e.clientY);
    const target = block(end?.node ?? null);
    if (!end || !target) return;
    if (anchor.closest('.ProseMirror') === target.closest('.ProseMirror')) {
      if (selected.length) {
        clear();
        doc.defaultView
          ?.getSelection()
          ?.setBaseAndExtent(pointerAnchor.node, pointerAnchor.offset, end.node, end.offset);
      }
      return;
    }
    across(anchor, target);
    doc.defaultView
      ?.getSelection()
      ?.setBaseAndExtent(pointerAnchor.node, pointerAnchor.offset, end.node, end.offset);
    e.preventDefault();
  };
  const onUp = (e: PointerEvent) => {
    extendPointer(e);
    if (anchor) across(anchor, block(doc.elementFromPoint?.(e.clientX, e.clientY) ?? (e.target as Node)));
    const start = pointerAnchor,
      end = pointAt(e.clientX, e.clientY);
    if (selected.length && start && end) {
      // Firefox can collapse the range as its native pointer-up/click finishes.
      // Restore the exact endpoints after that default action, before painting.
      pointerRestoreFrame = doc.defaultView!.requestAnimationFrame(() => {
        if (selected.length && start.node.isConnected && end.node.isConnected)
          doc.defaultView?.getSelection()?.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
      });
    }
    anchor = null;
    pointerAnchor = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (
      (!scope.contains(e.target as Node) &&
        !(selected.length && scope.contains(doc.defaultView?.getSelection()?.anchorNode ?? null))) ||
      (e.target as Element)?.closest?.('input,textarea,[role="dialog"]')
    )
      return;
    if (e.shiftKey && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      const native = doc.defaultView?.getSelection(),
        focus = block(native?.focusNode ?? null),
        root = focus?.closest('.ProseMirror');
      if (native?.focusNode && root && scope.contains(root)) {
        const prefix = doc.createRange();
        prefix.selectNodeContents(root);
        prefix.setEnd(native.focusNode, native.focusOffset);
        const backwards = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        const boundary = backwards
          ? prefix.toString().length === 0
          : prefix.toString().length === (root.textContent ?? '').length;
        const all = [...scope.querySelectorAll(BLOCK)].filter((el) => !el.parentElement?.closest(BLOCK));
        const endpoint = selected.length ? (backwards ? selected[0] : selected.at(-1)!) : focus;
        const next = endpoint ? all[all.indexOf(endpoint) + (backwards ? -1 : 1)] : null;
        if (next && (boundary || selected.length)) {
          across(block(native.anchorNode), next);
          if (selected.length) {
            if (native.anchorNode)
              native.setBaseAndExtent(
                native.anchorNode,
                native.anchorOffset,
                next,
                backwards ? 0 : next.childNodes.length,
              );
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
          }
        }
      }
    }
    if (!selected.length) return;
    if (e.key === 'Escape') {
      clear();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const remove = paths();
      clear();
      e.preventDefault();
      e.stopImmediatePropagation();
      commit({ kind: 'delete', paths: remove });
      return;
    }
    if ((e.key.length === 1 && !e.ctrlKey && !e.metaKey) || e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const prevent = (e: Event) => {
    if (selected.length && scope.contains(e.target as Node)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  doc.addEventListener('selectionchange', onSelection);
  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('pointermove', extendPointer, true);
  doc.addEventListener('pointerup', onUp, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('paste', prevent, true);
  doc.addEventListener('beforeinput', prevent, true);
  return {
    paths,
    clear,
    dispose() {
      clear();
      status.remove();
      doc.removeEventListener('selectionchange', onSelection);
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('pointermove', extendPointer, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('paste', prevent, true);
      doc.removeEventListener('beforeinput', prevent, true);
    },
  };
}
