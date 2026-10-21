import type { Profile, CommentRailItem } from "./contracts.ts";
import { fail } from "./errors.ts";
export function profileInput(input: {
  name?: unknown;
  image?: unknown;
}): Profile {
  if (typeof input.name !== "string" || input.name.trim().length > 80)
    fail(422, "Use a name of up to 80 characters.");
  const image = input.image;
  if (image !== null) {
    if (
      typeof image !== "string" ||
      image.length > 150000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
    )
      fail(422, "Choose a PNG, JPEG or WebP photo.");
    let bytes: string;
    try {
      bytes = atob(image.split(",")[1]!);
    } catch {
      return fail(422, "Invalid photo.");
    }
    if (
      !(
        (image.startsWith("data:image/png;") &&
          bytes.startsWith("\x89PNG\r\n\x1a\n")) ||
        (image.startsWith("data:image/jpeg;") &&
          bytes.startsWith("\xff\xd8\xff")) ||
        (image.startsWith("data:image/webp;") &&
          bytes.startsWith("RIFF") &&
          bytes.slice(8, 12) === "WEBP")
      )
    )
      fail(422, "Invalid photo.");
  }
  return { name: input.name.trim(), image };
}
export function railLayout(
  items: CommentRailItem[],
  minimum: number,
): CommentRailItem[] {
  let next = minimum;
  return items
    .map((item) => ({
      ...item,
      top: Number.isFinite(item.top) ? Math.max(minimum, item.top) : minimum,
    }))
    .sort((a, b) => a.top - b.top)
    .map((item) => {
      const top = Math.max(next, item.top);
      next = top + 44;
      return { ...item, top };
    });
}

export function otherViewers(
  viewers: import("./contracts.ts").Viewer[],
  actor: string | null,
  sessionId: string,
): import("./contracts.ts").Viewer[] {
  const seen = new Set<string>();
  return viewers.filter((v) => {
    if (v.actor === actor || v.sessionId === sessionId || seen.has(v.actor))
      return false;
    seen.add(v.actor);
    return true;
  });
}
export function commentTransition(
  state: import("./contracts.ts").CommentInteraction,
  event: import("./contracts.ts").CommentInteractionEvent,
): import("./contracts.ts").CommentInteraction {
  switch (event.kind) {
    case "hover":
      return state.pinned
        ? state
        : {
            ...state,
            active: event.id,
            expanded: Boolean(state.drafts[event.id]),
          };
    case "open":
    case "expand":
      return { ...state, active: event.id, pinned: true, expanded: true };
    case "leave":
      return state.pinned || (state.active && state.drafts[state.active])
        ? state
        : { ...state, active: null, expanded: false };
    case "close":
      return { ...state, active: null, pinned: false, expanded: false };
    case "draft":
      return {
        ...state,
        pinned: true,
        expanded: true,
        drafts: { ...state.drafts, [event.id]: event.body },
      };
    case "sent": {
      const drafts = { ...state.drafts };
      delete drafts[event.id];
      return { ...state, drafts };
    }
  }
}

/** Paint follows stable node identity in the current source/view, never saved coordinates. */
export function commentHighlights(
  comments: Array<{ nodeId: string }>,
  targets: Array<{
    id: string;
    rect: import("./contracts.ts").CommentTargetRect;
  }>,
  active: string | null,
): import("./contracts.ts").CommentHighlight[] {
  return [
    ...new Set([...comments.map((c) => c.nodeId), ...(active ? [active] : [])]),
  ].flatMap((nodeId) => {
    const rect = targets.find((t) => t.id === nodeId)?.rect;
    if (
      !rect ||
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return [];
    return [
      {
        nodeId,
        rect,
        emphasis: nodeId === active ? ("active" as const) : ("quiet" as const),
      },
    ];
  });
}

/**
 * Threads that get a marker in the rail: page-level threads always; a node's
 * thread only while its node is rendered (a node inside a hidden tab or
 * panel has an empty rect and gets none). A node the view does not have at
 * all keeps its marker, so its thread can still be opened. A saved view has
 * no live geometry: only page-level threads keep a marker there.
 */
export function markedThreads<T extends { nodeId: string | null }>(
  roots: readonly T[],
  targets: ReadonlyArray<{
    id: string;
    rect: import("./contracts.ts").CommentTargetRect;
  }>,
  live: boolean,
): T[] {
  return roots.filter((thread) => {
    if (thread.nodeId === null) return true;
    if (!live) return false;
    const target = targets.find((t) => t.id === thread.nodeId);
    return !target || (target.rect.width > 0 && target.rect.height > 0);
  });
}
