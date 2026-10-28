import { visibleSelectionRects } from "./presence-selection-geometry";
import { htmlTextFingerprint as selectionFingerprint } from '@artifactbin/contracts';
import type { PresenceRange, PresenceViewer } from '../html-presence/contract';
import {presenceGeometry} from '../html-presence/model';
type SelectionPresence = {ranges: PresenceRange[]};
type Viewer = Omit<PresenceViewer,'selection'> & {selection: SelectionPresence | null; actor: string};
function validateSelection(input:unknown):SelectionPresence|null {const selection=presenceGeometry({selection:(input as SelectionPresence|null)?.ranges}).selection;return selection?{ranges:selection}:null;}
const excluded =
  '[data-af="presence-overlay"],[data-af="annotation-overlay"],input,textarea,select,[contenteditable]:not([contenteditable="false"]),script,style,[hidden],[data-af-private]';
function safe(element: Element) {
  return !element.closest(excluded) && !element.querySelector(excluded);
}
function target(doc: Document, id: string) {
  const matches = [
    ...doc.querySelectorAll<HTMLElement>("[data-af-id]"),
  ].filter((e) => e.dataset.afId === id);
  return matches.length === 1 && matches[0] && safe(matches[0])
    ? matches[0]
    : null;
}
function encodeRange(doc: Document, range: Range, element: Element) {
  const prefix = doc.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  prefix.setEnd(range.endContainer, range.endOffset);
  const text = element.textContent ?? "";
  return {
    nodeId: element.getAttribute("data-af-id")!,
    start,
    end: prefix.toString().length,
    length: text.length,
    fingerprint: selectionFingerprint(text),
  };
}
/** Native text ranges only: canvas selections and private/editable anchors are omitted. */
export function captureSelection(doc: Document): SelectionPresence | null {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount > 8)
    return null;
  const ranges: SelectionPresence["ranges"] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i),
      root = range.commonAncestorContainer;
    let element = root.nodeType === 1 ? (root as Element) : root.parentElement;
    element = element?.closest("[data-af-id]") ?? null;
    if (
      element &&
      target(doc, element.getAttribute("data-af-id")!) === element
    ) {
      ranges.push(encodeRange(doc, range, element));
      continue;
    }
    // A body-wide common ancestor is deliberately not stamped: split public text
    // across existing identities, refusing partial publication across private UI.
    if (
      [...doc.querySelectorAll(excluded)].some(
        (el) => !el.closest('[data-af="presence-overlay"],[data-af="annotation-overlay"]') && range.intersectsNode(el),
      )
    )
      return null;
    const walker = doc.createTreeWalker(root, 4);
    let node = root.nodeType === 3 ? root : walker.nextNode(),
      visited = 0;
    while (node) {
      if (++visited > 3000) return null;
      if (
        range.intersectsNode(node) &&
        !node.parentElement?.closest('[data-af="presence-overlay"],[data-af="annotation-overlay"]')
      ) {
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
        if (!part.collapsed) {
          let anchor: Element | null = null;
          for (
            let candidate = node.parentElement?.closest("[data-af-id]");
            candidate && root.contains(candidate);
            candidate = candidate.parentElement?.closest("[data-af-id]")
          ) {
            if (
              target(doc, candidate.getAttribute("data-af-id")!) ===
              candidate
            )
              anchor = candidate;
          }
          if (!anchor) {
            if (part.toString().trim()) return null;
          } else {
            const encoded = encodeRange(doc, part, anchor),
              previous = ranges.at(-1);
            if (
              previous?.nodeId === encoded.nodeId &&
              previous.end === encoded.start
            )
              previous.end = encoded.end;
            else ranges.push(encoded);
            if (ranges.length > 8) return null;
          }
        }
      }
      node = root.nodeType === 3 ? null : walker.nextNode();
    }
  }
  return validateSelection({ ranges });
}

function resolve(doc: Document, input: SelectionPresence["ranges"][number]) {
  const element = target(doc, input.nodeId);
  if (
    !element ||
    element.textContent?.length !== input.length ||
    selectionFingerprint(element.textContent ?? "") !== input.fingerprint
  )
    return null;
  const walker = doc.createTreeWalker(element, 4);
  let node: Node | null,
    offset = 0;
  const range = doc.createRange();
  let started = false;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!started && input.start <= offset + length) {
      range.setStart(node, input.start - offset);
      started = true;
    }
    if (started && input.end <= offset + length) {
      range.setEnd(node, input.end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}
/** Paint with receiver geometry without touching either reader's native Selection. */
export function paintSelections(layer: HTMLElement, viewers: Viewer[]) {
  layer.replaceChildren();
  const doc = layer.ownerDocument;
  let count = 0;
  for (const viewer of viewers.slice(0, 50)) {
    const selection = validateSelection(viewer.selection);
    if (!selection) continue;
    const color = `hsl(${[...viewer.actor].reduce((n, c) => n * 31 + c.charCodeAt(0), 0) % 360} 70% 48%)`;
    let labelAttempted = false;
    const painted = new Set<string>();
    for (const input of selection.ranges) {
      const range = resolve(doc, input);
      if (!range) continue;
      for (const { rect, clip } of visibleSelectionRects(range)) {
        const key = [rect.x, rect.y, rect.width, rect.height].join(":");
        if (painted.has(key)) continue;
        painted.add(key);
        if (++count > 400) return;
        const mark = doc.createElement("div");
        mark.setAttribute("data-af-presence-selection", viewer.id);
        Object.assign(mark.style, {
          position: "fixed",
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          background: color,
          opacity: "0.22",
          pointerEvents: "none",
          userSelect: "none",
          webkitUserSelect: "none",
        });
        layer.append(mark);
        if (!labelAttempted) {
          labelAttempted = true;
          // Never move a label onto authored text to make it fit a tight scroller.
          if (clip.width < 32 || rect.y - 14 < clip.y) continue;
          const label = doc.createElement("div");
          label.className = "pg-selection-label";
          label.textContent = viewer.actor;
          Object.assign(label.style, {
            position: "fixed",
            left: `${Math.max(clip.x, Math.min(rect.x, clip.x + clip.width - Math.min(160, clip.width)))}px`,
            top: `${rect.y - 14}px`,
            maxWidth: `${clip.width}px`,
            width: `${Math.min(160, clip.width)}px`,
            height: `${Math.min(14, clip.height)}px`,
            boxSizing: "border-box",
            lineHeight: "12px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            font: "11px sans-serif",
            background: color,
            color: "white",
            padding: "1px 4px",
            pointerEvents: "none",
            userSelect: "none",
            webkitUserSelect: "none",
          });
          layer.append(label);
        }
      }
    }
  }
}
