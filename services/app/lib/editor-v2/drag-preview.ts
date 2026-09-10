/** Transient drag feedback. A destination is a different source sibling;
 * the insertion edge mirrors BlockEdit's target-index move semantics. */
export interface DragPreview {
  start(element: HTMLElement, path: string): void;
  update(x: number, y: number, keyboardTarget?: string): string | undefined;
  clear(): void;
  dispose(): void;
}
export function createDragPreview(doc: Document): DragPreview {
  const ghost = doc.createElement("div");
  ghost.setAttribute("data-mx-drag-preview", "");
  ghost.setAttribute("aria-hidden", "true");
  const caption = doc.createElement("div");
  const summary = doc.createElement("div");
  Object.assign(ghost.style, {
    position: "fixed",
    zIndex: "48",
    pointerEvents: "none",
    display: "none",
    width: "240px",
    maxWidth: "calc(100vw - 32px)",
    padding: "10px 14px",
    border: "1px solid rgba(100,116,139,.25)",
    borderRadius: "10px",
    background: "rgba(255,255,255,.96)",
    color: "#334155",
    boxShadow: "0 12px 32px rgba(15,23,42,.18)",
    font: "13px/1.5 system-ui",
  });
  Object.assign(caption.style, {
    fontSize: "11px",
    fontWeight: "600",
    marginBottom: "4px",
  });
  Object.assign(summary.style, {
    maxHeight: "58px",
    overflow: "hidden",
    overflowWrap: "anywhere",
  });
  ghost.append(caption, summary);
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
  doc.body.append(ghost, marker);
  let source: HTMLElement | null = null;
  let sourcePath = "";
  const parentPath = (path: string) => path.split(".").slice(0, -1).join(".");
  const sourceParent = (el: Element) =>
    el.parentElement?.closest("[data-mx-ast]");
  const clear = () => {
    source = null;
    ghost.style.display = marker.style.display = "none";
  };
  return {
    start(element, path) {
      source = element;
      sourcePath = path;
      // Never clone authored DOM: previews must not duplicate IDs, interactive
      // embeds, scripts, subscriptions or ProseMirror's owned nodes.
      summary.textContent =
        element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160) ||
        element.tagName.toLowerCase();
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
      caption.textContent = valid
        ? after
          ? "Drop after"
          : "Drop before"
        : "Can’t drop here";
      caption.style.color = valid ? "#15803d" : "#b91c1c";
      ghost.style.borderColor = valid
        ? "rgba(22,163,74,.4)"
        : "rgba(220,38,38,.4)";
      ghost.setAttribute("data-mx-drop-valid", String(valid));
      Object.assign(ghost.style, {
        display: "block",
        left: `${Math.max(8, Math.min(x + 18, (doc.defaultView?.innerWidth ?? 1000) - 280))}px`,
        top: `${Math.max(8, Math.min(y + 18, (doc.defaultView?.innerHeight ?? 800) - 110))}px`,
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
      ghost.remove();
      marker.remove();
    },
  };
}
