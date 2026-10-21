import type { Target, Viewer } from "../contracts.ts";
import { otherViewers } from "../chrome-model.ts";
export interface CursorFrame {
  viewers: Viewer[];
  actor: string | null;
  sessionId: string;
  sourceRevision: string;
  targets: Target[];
  width: number;
  inset: number;
}
/** One renderable cursor per other actor; ineligible sessions cannot mask it. */
export interface CursorPosition {
  actor: string;
  x: number;
  y: number;
}
export function cursorPositions(frame: CursorFrame): CursorPosition[] {
  const eligible = frame.viewers.filter(
    (viewer) =>
      viewer.sourceRevision === frame.sourceRevision &&
      viewer.cursor &&
      frame.targets.some((target) => target.id === viewer.cursor!.nodeId),
  );
  return otherViewers(eligible, frame.actor, frame.sessionId).flatMap(
    (viewer) => {
      if (viewer.sourceRevision !== frame.sourceRevision || !viewer.cursor)
        return [];
      const rect = frame.targets.find(
        (target) => target.id === viewer.cursor!.nodeId,
      )?.rect;
      if (!rect) return [];
      return [
        {
          actor: viewer.actor,
          x: Math.max(
            0,
            Math.min(frame.width - 100, rect.x + rect.width * viewer.cursor.x),
          ),
          y: Math.max(
            frame.inset,
            rect.y + rect.height * viewer.cursor.y + frame.inset,
          ),
        },
      ];
    },
  );
}
/** Paint-only adapter. Presence filtering and geometry are independent from the DOM. */
export function drawCursorLayer(
  layer: HTMLElement,
  frame: CursorFrame | null,
): void {
  layer.replaceChildren();
  if (!frame) return;
  for (const cursor of cursorPositions(frame)) {
    const el = layer.ownerDocument.createElement("span");
    el.className = "pg-cursor";
    el.textContent = "↖ " + cursor.actor;
    el.style.left = cursor.x + "px";
    el.style.top = cursor.y + "px";
    layer.append(el);
  }
}
