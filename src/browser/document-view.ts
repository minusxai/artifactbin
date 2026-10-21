import { jsonCopy } from "../json.ts";
import { compact } from "../model.ts";
import type { DocumentState, Snapshot, Target } from "../contracts.ts";
import type {
  DocumentView,
  DocumentViewOptions,
  DocumentViewContext,
  DocumentViewChange,
} from "./document-view-contracts.ts";
function snapshot(value: unknown): Snapshot | null {
  if (value === null || value === undefined) return null;
  const copy = jsonCopy(value) as Snapshot;
  if (
    !copy ||
    !Number.isSafeInteger(copy.schema) ||
    copy.schema < 0 ||
    typeof copy.sourceRevision !== "string" ||
    !copy.sourceRevision ||
    !copy.state ||
    typeof copy.state !== "object" ||
    Array.isArray(copy.state) ||
    !copy.view ||
    !Number.isFinite(copy.view.x) ||
    !Number.isFinite(copy.view.y) ||
    (copy.rendered !== undefined && typeof copy.rendered !== "string")
  )
    throw Error("Invalid app snapshot");
  return copy;
}
function geometry(value: unknown): Target[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3000)
    throw Error("Invalid app targets");
  return value.map((item) => {
    const target = jsonCopy(item) as Target;
    if (
      !target ||
      typeof target.id !== "string" ||
      typeof target.quote !== "string" ||
      !target.rect ||
      !["x", "y", "width", "height"].every((key) =>
        Number.isFinite(target.rect[key as keyof Target["rect"]]),
      )
    )
      throw Error("Invalid app target");
    return target;
  });
}
/** Source is immutable; live state, historical selection and asynchronous context ownership stay together. */
export function createDocumentView(options: DocumentViewOptions): DocumentView {
  let current = snapshot(options.snapshot),
    own: Snapshot | null = null,
    revision = options.revision,
    historical = false,
    targets: Target[] = [],
    selection = 0,
    disposed = false,
    started = false;
  const canonicalSource = options.source,
    canonicalRevision = options.revision;
  if (current && current.sourceRevision !== canonicalRevision)
    throw Error("App snapshot belongs to another source");
  function changed(
    kind: DocumentViewChange["kind"],
    previous: Snapshot | null,
  ) {
    options.changed({
      kind,
      snapshotChanged: JSON.stringify(previous) !== JSON.stringify(current),
      hadSnapshot: previous !== null,
    });
  }
  function show(context: DocumentViewContext, expectedRevision?: string) {
    const next = snapshot(context.snapshot),
      nextRevision = expectedRevision || next?.sourceRevision;
    if (
      typeof context.source !== "string" ||
      !nextRevision ||
      (next && next.sourceRevision !== nextRevision)
    )
      throw Error("Saved context belongs to another source");
    const previous = current;
    options.activity.suspend("history");
    options.surface.suspend();
    if (!historical) own = current;
    historical = true;
    current = next;
    revision = nextRevision;
    targets = [];
    options.surface.mount(context.source, current, revision, true);
    changed("history", previous);
  }
  return {
    get snapshot() {
      return current;
    },
    get revision() {
      return revision;
    },
    get historical() {
      return historical;
    },
    get targets() {
      return [...targets];
    },
    start() {
      if (disposed || started) return;
      started = true;
      if (options.contextOnly) {
        options.activity.suspend("saved-context");
        historical = true;
        options.surface.suspend();
      }
      options.surface.mount(
        canonicalSource,
        current,
        canonicalRevision,
        historical,
      );
      if (options.contextOnly) changed("saved-context", current);
    },
    receiveView(message) {
      if (disposed || historical) return false;
      const next = snapshot(message.snapshot);
      if (next && next.sourceRevision !== canonicalRevision) return false;
      const nextTargets = geometry(message.targets),
        previous = current;
      current = next;
      targets = nextTargets;
      changed("live", previous);
      return true;
    },
    async showComment(comment) {
      if (disposed || options.contextOnly) return;
      const token = ++selection;
      const cache = options.contexts.cached();
      let context: DocumentViewContext = {
        source:
          comment.sourceRevision === canonicalRevision
            ? canonicalSource
            : cache.sources?.[comment.sourceRevision]!,
        snapshot: comment.appStateId
          ? (cache.snapshots[comment.appStateId] ?? null)
          : null,
      };
      // Without a cached view, ask the server for what the commenter saw; a
      // comment saved without one still opens on its source.
      if (!context.source || !context.snapshot) {
        const fallback = !comment.appStateId && context.source ? context : null;
        try {
          context = await options.contexts.comment(comment.id);
        } catch {
          if (disposed || selection !== token) return;
          if (!fallback)
            throw Error(
              "This context is not cached. Connect to its server to view it.",
            );
          context = fallback;
        }
      }
      if (!disposed && selection === token)
        show(context, comment.sourceRevision);
    },
    async showViewer(sessionId) {
      if (disposed || options.contextOnly) return;
      const token = ++selection;
      let context: DocumentViewContext;
      try {
        context = await options.contexts.viewer(sessionId);
      } catch (error) {
        if (!disposed && selection === token) throw error;
        return;
      }
      if (!disposed && selection === token) show(context);
    },
    returnLive() {
      selection++;
      if (disposed || !historical || options.contextOnly) return false;
      const previous = current;
      current = own;
      own = null;
      historical = false;
      revision = canonicalRevision;
      targets = [];
      options.activity.resume("history");
      options.surface.mount(canonicalSource, current, revision, false);
      changed("return", previous);
      return true;
    },
    envelope(state: DocumentState) {
      const result = {
        ...state,
        app: historical && !options.contextOnly ? own : current,
      };
      return state.remote ? compact(result) : result;
    },
    dispose() {
      disposed = true;
      selection++;
      targets = [];
    },
  };
}
