import type {
  SelectionPaintRect,
  VisibleSelectionRect,
} from "./presence-selection-geometry-contracts";
const clips = /^(auto|scroll|hidden|clip)$/;
function intersect(
  a: SelectionPaintRect,
  b: SelectionPaintRect,
): SelectionPaintRect {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}
function clippingBounds(text: Node, doc: Document): SelectionPaintRect {
  let bounds: SelectionPaintRect = {
    x: 0,
    y: 0,
    width: doc.documentElement.clientWidth,
    height: doc.documentElement.clientHeight,
  };
  for (
    let element = text.parentElement;
    element;
    element = element.parentElement
  ) {
    const style = doc.defaultView!.getComputedStyle(element);
    const x = clips.test(style.overflowX),
      y = clips.test(style.overflowY);
    if (!x && !y) continue;
    const rect = element.getBoundingClientRect();
    // Overflow clips at the padding box. Client dimensions exclude scrollbars.
    const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight
      ? rect.height / element.offsetHeight
      : 1;
    const left = rect.left + element.clientLeft * scaleX,
      top = rect.top + element.clientTop * scaleY;
    bounds = intersect(bounds, {
      x: x ? left : bounds.x,
      y: y ? top : bounds.y,
      width: x ? element.clientWidth * scaleX : bounds.width,
      height: y ? element.clientHeight * scaleY : bounds.height,
    });
  }
  return bounds;
}
/** Resolve each text run separately: siblings can have different clipping ancestors. */
export function visibleSelectionRects(range: Range): VisibleSelectionRect[] {
  const doc = range.startContainer.ownerDocument!;
  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(root, 4);
  let node: Node | null = root.nodeType === 3 ? root : walker.nextNode(),
    visited = 0,
    rects = 0;
  const output: VisibleSelectionRect[] = [];
  while (node && visited++ < 3000 && rects < 100) {
    if (range.intersectsNode(node)) {
      const part = doc.createRange();
      part.setStart(
        node,
        node === range.startContainer ? range.startOffset : 0,
      );
      part.setEnd(
        node,
        node === range.endContainer
          ? range.endOffset
          : (node.textContent?.length ?? 0),
      );
      const clip = clippingBounds(node, doc);
      if (clip.width > 0 && clip.height > 0)
        for (const rect of part.getClientRects()) {
          if (++rects > 100) break;
          const visible = intersect(rect, clip);
          if (visible.width > 0 && visible.height > 0)
            output.push({ rect: visible, clip });
        }
    }
    node = root.nodeType === 3 ? null : walker.nextNode();
  }
  return output;
}
