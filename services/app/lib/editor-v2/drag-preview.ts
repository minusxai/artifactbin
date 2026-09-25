/** Transient drag feedback. A destination is a different source sibling;
 * the insertion edge mirrors BlockEdit's target-index move semantics.
 *
 * A small label follows the pointer naming what is being dragged. It stays
 * neutral while the drop would do nothing (over the block itself) and while a
 * slot is found: a pointer that wanders out of the parent SNAPS to the nearest
 * sibling slot instead of reading as an error. Only a block with genuinely
 * nowhere to go turns the label red, with the reason. */
export interface DragLabels {
  /** What the block is called (the toolbar's node name). */
  label: string;
  /** What its parent is called, for "Can only move within this …". */
  parent: string;
}
export interface DragPreview {
  start(element: HTMLElement, path: string, labels?: DragLabels): void;
  update(x: number, y: number, keyboardTarget?: string): string | undefined;
  clear(): void;
  dispose(): void;
}
type DropState = "none" | "valid" | "invalid";
const RAIL = ".mx-rail, .mx-present";
export function createDragPreview(doc: Document): DragPreview {
  const indicator = doc.createElement("div");
  indicator.setAttribute("data-mx-drag-preview", "");
  indicator.setAttribute("aria-hidden", "true");
  Object.assign(indicator.style, {
    position: "fixed",
    zIndex: "48",
    pointerEvents: "none",
    display: "none",
    padding: "2px 8px",
    borderRadius: "6px",
    font: "500 12px/18px system-ui, sans-serif",
    whiteSpace: "nowrap",
    color: "#fff",
    background: "rgba(51, 65, 85, 0.92)",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.18)",
  });
  const marker = doc.createElement("div");
  marker.setAttribute("data-mx-drop-marker", "");
  Object.assign(marker.style, {
    position: "fixed",
    zIndex: "47",
    pointerEvents: "none",
    display: "none",
    height: "3px",
    borderRadius: "3px",
    background: "#16a34a",
    boxShadow: "0 0 0 2px rgba(22,163,74,.12)",
  });
  // While dragging, the cursor says whether letting go does anything.
  const cursor = doc.createElement("style");
  doc.head.append(cursor);
  doc.body.append(indicator, marker);
  let source: HTMLElement | null = null;
  let sourcePath = "";
  let labels: DragLabels = { label: "Block", parent: "container" };
  const parentPath = (path: string) => path.split(".").slice(0, -1).join(".");
  const sourceParent = (el: Element) =>
    el.parentElement?.closest("[data-mx-ast]");
  const clear = () => {
    source = null;
    indicator.style.display = marker.style.display = "none";
    cursor.textContent = "";
  };
  /** Every stamped sibling of the source, itself included, in document order. */
  const siblings = (): HTMLElement[] => {
    if (!source) return [];
    const parent = sourceParent(source);
    const depth = sourcePath.split(".").length;
    return [...(parent ?? doc).querySelectorAll<HTMLElement>("[data-mx-ast]")].filter((el) => {
      const path = el.getAttribute("data-mx-ast")!;
      return (
        path.split(".").length === depth &&
        parentPath(path) === parentPath(sourcePath) &&
        sourceParent(el) === sourceParent(source!) &&
        !el.closest(RAIL)
      );
    });
  };
  /** The sibling nearest the pointer (the source counts: nearest to itself means stay). */
  const nearest = (x: number, y: number, candidates: HTMLElement[]) => {
    let best: HTMLElement | null = null,
      distance = Infinity;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right),
        dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < distance) [best, distance] = [el, d];
    }
    return best;
  };
  const show = (x: number, y: number, state: DropState) => {
    indicator.textContent =
      state === "invalid" ? `Can only move within this ${labels.parent.toLowerCase()}` : `⠿ ${labels.label}`;
    indicator.setAttribute("data-mx-drop-state", state);
    indicator.style.background = state === "invalid" ? "rgba(220, 38, 38, 0.92)" : "rgba(51, 65, 85, 0.92)";
    cursor.textContent = `* { cursor: ${state === "invalid" ? "not-allowed" : "grabbing"} !important; }`;
    indicator.style.display = "block";
    // Beside the pointer, on whichever side keeps the WHOLE label on screen.
    const { width, height } = indicator.getBoundingClientRect();
    const place = (at: number, size: number, room: number) => {
      const after = at + 14,
        before = at - 14 - size;
      const pick = after + size <= room - 8 || before < 8 ? after : before;
      return Math.max(8, Math.min(pick, room - size - 8));
    };
    indicator.style.left = `${place(x, width, doc.defaultView?.innerWidth ?? 1000)}px`;
    indicator.style.top = `${place(y, height, doc.defaultView?.innerHeight ?? 800)}px`;
    if (state !== "valid") marker.style.display = "none";
  };
  return {
    start(element, path, names) {
      source = element;
      sourcePath = path;
      if (names) labels = names;
    },
    update(x, y, keyboardTarget) {
      if (!source?.isConnected) {
        clear();
        return;
      }
      const family = siblings();
      let target: Element | null = keyboardTarget
        ? (family.find((el) => el.getAttribute("data-mx-ast") === keyboardTarget) ?? null)
        : (doc.elementFromPoint(x, y)?.closest("[data-mx-ast]") ?? null);
      if (!keyboardTarget) {
        // A hit inside a sibling resolves to that sibling; anything else snaps.
        while (target && !family.includes(target as HTMLElement))
          target = target.parentElement?.closest("[data-mx-ast]") ?? null;
        target ??= nearest(x, y, family);
      }
      if (family.length < 2) {
        show(x, y, "invalid");
        return;
      }
      if (!target || target === source) {
        show(x, y, "none");
        return;
      }
      const path = target.getAttribute("data-mx-ast")!;
      const after = Number(path.split(".").at(-1)) > Number(sourcePath.split(".").at(-1));
      show(x, y, "valid");
      marker.style.display = "block";
      const r = target.getBoundingClientRect(),
        s = source.getBoundingClientRect();
      const horizontal =
        Math.min(r.bottom, s.bottom) > Math.max(r.top, s.top) &&
        (r.left >= s.right || r.right <= s.left);
      const edge = after
        ? r.left >= s.right
          ? r.right
          : r.left
        : r.left < s.left
          ? r.left
          : r.right;
      Object.assign(
        marker.style,
        horizontal
          ? {
              left: `${edge}px`,
              top: `${r.top}px`,
              width: "3px",
              height: `${r.height}px`,
            }
          : {
              left: `${r.left}px`,
              top: `${after ? r.bottom : r.top}px`,
              width: `${r.width}px`,
              height: "3px",
            },
      );
      return path;
    },
    clear,
    dispose() {
      clear();
      indicator.remove();
      marker.remove();
      cursor.remove();
    },
  };
}
