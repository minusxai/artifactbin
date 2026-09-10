/** Explicit fallback for ranges crossing independent editor/component boundaries. */
import type { BlockEdit } from './block-edit';
const BLOCK =
  'p[data-mx-ast],h1[data-mx-ast],h2[data-mx-ast],h3[data-mx-ast],h4[data-mx-ast],h5[data-mx-ast],h6[data-mx-ast],li[data-mx-ast],pre[data-mx-ast]';
export function createBlockSelection(doc: Document, scope: HTMLElement | Document, commit: (edit: BlockEdit) => void) {
  let selected: Element[] = [];
  let anchor: Element | null = null;
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('data-mx-block-status', '');
  Object.assign(status.style, {
    position: 'fixed',
    bottom: '16px',
    left: '16px',
    zIndex: '46',
    background: 'white',
    color: '#115e59',
    padding: '8px',
    border: '1px solid #14b8a6',
    borderRadius: '5px',
    display: 'none',
  });
  doc.body.append(status);
  const paths = () => selected.map((el) => el.getAttribute('data-mx-ast')!).filter(Boolean);
  const clear = () => {
    selected.forEach((el) => el.removeAttribute('data-mx-block-selected'));
    selected = [];
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
    clear();
    selected = blocks.slice(Math.min(from, to), Math.max(from, to) + 1);
    selected.forEach((el) => el.setAttribute('data-mx-block-selected', ''));
    status.textContent = `${selected.length} blocks selected. Delete removes them; Escape cancels. Typing and paste do not replace this selection.`;
    status.style.display = 'block';
  };
  const onSelection = () => {
    const range = doc.defaultView?.getSelection();
    if (!range || range.isCollapsed) return;
    across(block(range.anchorNode), block(range.focusNode));
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element)?.closest?.('[data-mx-node-chrome]')) return;
    clear();
    anchor = block(e.target as Node);
  };
  const onUp = (e: PointerEvent) => {
    if (anchor) across(anchor, block(doc.elementFromPoint?.(e.clientX, e.clientY) ?? (e.target as Node)));
    anchor = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (!scope.contains(e.target as Node) || (e.target as Element)?.closest?.('input,textarea,[role="dialog"]')) return;
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
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('paste', prevent, true);
      doc.removeEventListener('beforeinput', prevent, true);
    },
  };
}
