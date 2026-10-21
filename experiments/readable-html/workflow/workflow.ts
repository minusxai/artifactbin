import type {
  Access,
  Json,
  BridgeLifecycle,
  Codec,
  Comment,
  CommentInput,
  FaultCode,
  Principal,
  Repository,
  Source,
} from "./contracts.ts";
class Fault extends Error {
  constructor(public code: FaultCode) {
    super(code);
  }
}
const fail = (code: FaultCode): never => {
  throw new Fault(code);
};
const copy = <T>(value: T): T => structuredClone(value);
function json(value: unknown, stack = new Set<object>()): asserts value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || stack.has(value as object)) fail("INVALID");
  const object = value as object;
  if (
    !Array.isArray(object) &&
    Object.getPrototypeOf(object) !== Object.prototype &&
    Object.getPrototypeOf(object) !== null
  )
    fail("INVALID");
  stack.add(object);
  if (Array.isArray(object)) {
    for (let i = 0; i < object.length; i++) {
      if (!Object.hasOwn(object, i)) fail("INVALID");
      json(object[i], stack);
    }
  } else {
    for (const name of Reflect.ownKeys(object)) {
      if (typeof name !== "string") fail("INVALID");
      json((object as Record<string, unknown>)[name as string], stack);
    }
  }
  stack.delete(object);
}
// JSON semantic equality ignores object key ordering for retries.
function key(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value)
    ? `[${value.map(key).join(",")}]`
    : `{${Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + key((value as Record<string, unknown>)[k]))
        .join(",")}}`;
}
export function createRepository(codec: Codec): Repository {
  interface Document {
    owner: Principal;
    access: Access;
    editors: Set<Principal>;
    current: string;
    history: Map<string, Source>;
    comments: Map<string, Comment>;
  }
  const documents = new Map<string, Document>();
  const load = (id: string) => documents.get(id) ?? fail("NOT_FOUND");
  const allowed = (d: Document, actor: Principal | null, write = false) => {
    if (
      actor === d.owner ||
      (actor !== null && d.editors.has(actor)) ||
      (!write && d.access !== "private")
    )
      return;
    fail("DENIED");
  };
  const version = (d: Document, revision: string) =>
    d.history.get(revision) ?? fail("HISTORY_UNAVAILABLE");
  const pull = (actor: Principal | null, id: string, revision?: string) => {
    const d = load(id);
    allowed(d, actor);
    return { ...copy(version(d, revision ?? d.current)), documentId: id };
  };
  return {
    async create(actor, id, html, access) {
      const normalized = await codec.decode(html);
      if (documents.has(id)) fail("CONFLICT");
      documents.set(id, {
        owner: actor,
        access,
        editors: new Set(),
        current: normalized.revision,
        history: new Map([
          [
            normalized.revision,
            {
              source: normalized.source,
              revision: normalized.revision,
              initialState: copy(normalized.initialState),
            },
          ],
        ]),
        comments: new Map(),
      });
      return pull(actor, id);
    },
    pull,
    async push(actor, id, expectedRevision, html) {
      allowed(load(id), actor, true);
      const normalized = await codec.decode(html);
      const d = load(id);
      allowed(d, actor, true);
      if (d.current !== expectedRevision) fail("CONFLICT");
      const source = {
        source: normalized.source,
        revision: normalized.revision,
        initialState: copy(version(d, d.current).initialState),
      };
      d.history.set(source.revision, copy(source));
      d.current = source.revision;
      return pull(actor, id);
    },
    comment(actor, id, input: CommentInput) {
      const d = load(id);
      allowed(d, actor, true);
      if (!input.id || !input.targetId || !input.body) fail("INVALID");
      json(input.snapshot);
      version(d, input.sourceRevision);
      const comment: Comment = {
        id: input.id,
        sourceRevision: input.sourceRevision,
        snapshot: copy(input.snapshot),
        targetId: input.targetId,
        body: input.body,
        author: actor,
      };
      const previous = d.comments.get(input.id);
      if (previous) {
        if (key(previous) !== key(comment)) fail("IDEMPOTENCY_CONFLICT");
        return copy(previous);
      }
      d.comments.set(input.id, comment);
      return copy(comment);
    },
    inspect(actor, id) {
      const d = load(id);
      allowed(d, actor);
      return copy([...d.comments.values()]);
    },
    context(actor, id, commentId) {
      const d = load(id);
      allowed(d, actor);
      const comment = d.comments.get(commentId) ?? fail("NOT_FOUND");
      return copy({ comment, source: version(d, comment.sourceRevision) });
    },
    share(actor, id, access, editors) {
      const d = load(id);
      if (d.owner !== actor) fail("DENIED");
      d.access = access;
      d.editors = new Set(editors);
    },
  };
}
export function createBridge(): BridgeLifecycle {
  let generation = 0,
    active = false;
  return {
    attach() {
      active = true;
      return ++generation;
    },
    suspend() {
      active = false;
    },
    accept(candidate, effect) {
      if (!active || candidate !== generation) return false;
      effect();
      return true;
    },
  };
}
