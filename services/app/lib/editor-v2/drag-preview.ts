/** Transient drag feedback. A destination is a different source sibling;
 * the insertion edge mirrors BlockEdit's target-index move semantics. */
export interface DragPreview {
  start(element: HTMLElement, path: string): void;
  update(x: number, y: number, keyboardTarget?: string): string | undefined;
  clear(): void;
  dispose(): void;
}
export function createDragPreview(doc: Document): DragPreview {
  const indicator = doc.createElement("div");
  indicator.setAttribute("data-mx-drag-preview", "");
  indicator.setAttribute("aria-hidden", "true");
  Object.assign(indicator.style, {
    position: "fixed",
    zIndex: "48",
    pointerEvents: "none",
    display: "none",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#dc2626",
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
  doc.body.append(indicator, marker);
  let source: HTMLElement | null = null;
  let sourcePath = "";
  const parentPath = (path: string) => path.split(".").slice(0, -1).join(".");
  const sourceParent = (el: Element) =>
    el.parentElement?.closest("[data-mx-ast]");
  const clear = () => {
    source = null;
    indicator.style.display = marker.style.display = "none";
  };
  return {
    start(element, path) {
      source = element;
      sourcePath = path;
    },
    update(x, y, keyboardTarget) {
      if (!source?.isConnected) {
        clear();
        return;
      }
      let target = keyboardTarget
        ? (source.parentElement?.querySelector(
            `[data-mx-ast="${CSS.escape(keyboardTarget)}"]`,
          ) ?? null)
        : (doc.elementFromPoint(x, y)?.closest("[data-mx-ast]") ?? null);
      const depth = sourcePath.split(".").length;
      while (
        target &&
        target.getAttribute("data-mx-ast")?.split(".").length !== depth
      )
        target = target.parentElement?.closest("[data-mx-ast]") ?? null;
      const path = target?.getAttribute("data-mx-ast");
      const valid =
        !!target &&
        !!path &&
        target !== source &&
        path !== sourcePath &&
        parentPath(path) === parentPath(sourcePath) &&
        sourceParent(target) === sourceParent(source);
      const after =
        valid &&
        Number(path!.split(".").at(-1)) > Number(sourcePath.split(".").at(-1));
      indicator.style.background = valid ? "#16a34a" : "#dc2626";
      indicator.setAttribute("data-mx-drop-valid", String(valid));
      Object.assign(indicator.style, {
        display: "block",
        left: `${Math.max(8, Math.min(x + 12, (doc.defaultView?.innerWidth ?? 1000) - 16))}px`,
        top: `${Math.max(8, Math.min(y + 12, (doc.defaultView?.innerHeight ?? 800) - 16))}px`,
      });
      marker.style.display = valid ? "block" : "none";
      if (!valid) return;
      const r = target!.getBoundingClientRect(),
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
      return path!;
    },
    clear,
    dispose() {
      clear();
      indicator.remove();
      marker.remove();
    },
  };
}
