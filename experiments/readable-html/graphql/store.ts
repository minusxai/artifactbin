import {
  buildSchema,
  Lexer,
  Source,
  TokenKind,
  execute,
  getVariableValues,
  getOperationAST,
  graphqlSync,
  GraphQLError,
  parse,
  validate,
  type DocumentNode,
  type SelectionSetNode,
  type ExecutionResult,
} from "graphql";
import type {
  Json,
  Snapshot,
  StoreOptions,
  Store,
  RemoteOptions,
  RemoteOperation,
} from "./contracts.ts";
const failure = (e: unknown): ExecutionResult => ({
  errors: [new GraphQLError(e instanceof Error ? e.message : String(e))],
});
function json(value: unknown, seen = new Set<object>()): asserts value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || !value || seen.has(value))
    throw Error("State must be finite acyclic JSON");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null)
    throw Error("State must be plain JSON");
  if (Reflect.ownKeys(value).some((k) => typeof k === "symbol"))
    throw Error("Symbol property");
  if (
    Array.isArray(value) &&
    (Object.keys(value).length !== value.length ||
      Object.keys(value).some((key, index) => key !== String(index)))
  )
    throw Error("Sparse or decorated array");
  if (
    Object.getOwnPropertyNames(value).length !==
    Object.keys(value).length + (Array.isArray(value) ? 1 : 0)
  )
    throw Error("Nonenumerable property");
  seen.add(value);
  for (const key of Object.keys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in d)) throw Error("Accessor");
    json(d.value, seen);
  }
  seen.delete(value);
}
const clone = <T>(v: T): T => structuredClone(v);
function freeze(v: any): any {
  if (v && typeof v === "object") {
    Object.freeze(v);
    for (const x of Object.values(v)) freeze(x);
  }
  return v;
}
function boundedDocument(source: string): DocumentNode {
  if (new TextEncoder().encode(source).length > 16384)
    throw Error("Operation exceeds 16KiB budget");
  // Lexical nesting limit bounds parser recursion before AST validation.
  let nesting = 0;
  const lexer = new Lexer(new Source(source));
  for (
    let token = lexer.advance();
    token.kind !== TokenKind.EOF;
    token = lexer.advance()
  ) {
    if (["{", "(", "["].includes(token.kind)) nesting++;
    if (["}", ")", "]"].includes(token.kind)) nesting--;
    if (nesting > 64) throw Error("Syntax nesting budget exceeded");
  }
  const document = parse(source);
  const fragments = new Map(
    document.definitions
      .filter((d) => d.kind === "FragmentDefinition")
      .map((d) => [d.name.value, d]),
  );
  let fields = 0;
  function walk(set: SelectionSetNode, depth: number, path: Set<string>) {
    if (depth > 32) throw Error("Selection depth budget exceeded");
    for (const selection of set.selections) {
      if (++fields > 512) throw Error("Expanded selection budget exceeded");
      if (selection.kind === "FragmentSpread") {
        const name = selection.name.value;
        if (path.has(name)) throw Error("Fragment cycle");
        const f = fragments.get(name);
        if (f) walk(f.selectionSet, depth, new Set([...path, name]));
      } else if (selection.selectionSet)
        walk(selection.selectionSet, depth + 1, path);
    }
  }
  for (const d of document.definitions)
    if (d.kind === "OperationDefinition") walk(d.selectionSet, 0, new Set());
  return document;
}
export function migrateSnapshot(
  snapshot: Snapshot,
  target: number,
  migrations: Record<number, (state: Json) => Json>,
): Snapshot {
  if (
    !Number.isSafeInteger(snapshot.version) ||
    snapshot.version < 1 ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Number.isSafeInteger(target) ||
    target < snapshot.version
  )
    throw Error("Invalid migration target");
  json(snapshot.state);
  let next = clone(snapshot);
  while (next.version < target) {
    const migrate = migrations[next.version];
    if (!migrate) throw Error("Missing migration");
    const state = migrate(freeze(clone(next.state)));
    json(state);
    next = { ...next, state: clone(state), version: next.version + 1 };
  }
  return next;
}
export function createStore(options: StoreOptions): Store {
  json(options.initial);
  if (!Number.isSafeInteger(options.version) || options.version < 1)
    throw Error("Invalid version");
  const schema = buildSchema(options.sdl);
  let state = clone(options.initial),
    revision = 0,
    disposed = false,
    busy = false;
  const watchers = new Set<{
    source: string;
    variables?: Record<string, unknown>;
    callback: (r: ExecutionResult) => void;
    key?: string;
  }>();
  function run(
    source: string,
    variables: Record<string, unknown> | undefined,
    mutation: boolean,
  ): ExecutionResult {
    if (disposed) return failure("Store disposed");
    if (mutation && busy) return failure("Reentrant mutation");
    const previousBusy = busy;
    busy = true;
    try {
      const doc = boundedDocument(source);
      const op = getOperationAST(doc);
      if (!op || op.operation !== (mutation ? "mutation" : "query"))
        return failure("Explicit operation kind required");
      const draft = clone(state);
      if (!mutation) freeze(draft);
      const roots = mutation ? options.mutations : options.queries;
      const rootValue = Object.fromEntries(
        Object.entries(roots).map(([name, fn]) => [
          name,
          (args: Record<string, any>) => {
            const value = fn(draft, args);
            if (value && typeof (value as any).then === "function") {
              Promise.resolve(value).catch(() => {});
              throw Error("Local resolvers must be synchronous");
            }
            return value;
          },
        ]),
      );
      const result = graphqlSync({
        schema,
        source,
        variableValues: variables,
        rootValue,
      });
      if (mutation && !result.errors) {
        json(draft);
        state = clone(draft);
        revision++;
        for (const watcher of [...watchers])
          if (watchers.has(watcher)) notify(watcher);
      }
      return mutation && result.errors ? { errors: result.errors } : result;
    } catch (e) {
      return failure(e);
    } finally {
      busy = previousBusy;
    }
  }
  function notify(w: typeof watchers extends Set<infer T> ? T : never) {
    const result = run(w.source, w.variables, false),
      key = JSON.stringify(result);
    if (key !== w.key) {
      w.key = key;
      try {
        w.callback(result);
      } catch {
        /* one consumer cannot suppress other consumers */
      }
    }
  }
  return {
    query: (s, v) => run(s, v, false),
    mutate: (s, v) => run(s, v, true),
    snapshot: () => ({
      version: options.version,
      revision,
      state: clone(state),
    }),
    watch(source, callback, variables) {
      if (disposed) throw Error("Store disposed");
      const w = { source, callback, variables: clone(variables) };
      watchers.add(w);
      const old = busy;
      busy = true;
      try {
        notify(w);
      } finally {
        busy = old;
      }
      return () => {
        watchers.delete(w);
      };
    },
    dispose() {
      disposed = true;
      watchers.clear();
    },
  };
}
export function createRemote(options: RemoteOptions) {
  const schema = buildSchema(options.sdl);
  return {
    execute(
      source: string,
      variables?: Record<string, unknown>,
    ): RemoteOperation {
      const controller = new AbortController();
      let cancel!: () => void;
      const cancelled = new Promise<import("./contracts.ts").RemoteReceipt>(
        (resolve) => {
          cancel = () => {
            controller.abort();
            resolve({
              status: "unknown",
              reason: "Cancellation does not prove server rollback",
            });
          };
        },
      );
      const work = (async (): Promise<
        import("./contracts.ts").RemoteReceipt
      > => {
        try {
          const document = boundedDocument(source);
          const kind = getOperationAST(document)?.operation;
          if (kind !== "mutation" && kind !== "query")
            throw Error("Explicit query or mutation required");
          const errors = validate(schema, document);
          if (errors.length) return { status: "rejected", result: { errors } };
          // Multiple remote side effects cannot promise atomic rollback. One root response field only.
          const op = getOperationAST(document)!;
          if (
            op.selectionSet.selections.length !== 1 ||
            op.selectionSet.selections[0].kind !== "Field"
          )
            throw Error("Exactly one remote root field required");
          if (
            !Object.hasOwn(
              options.resolvers,
              op.selectionSet.selections[0].name.value,
            )
          )
            throw Error("Missing remote resolver");
          const vars = getVariableValues(
            schema,
            op.variableDefinitions ?? [],
            variables ?? {},
          );
          if (vars.errors)
            return { status: "rejected", result: { errors: vars.errors } };
          if (!options.online()) return { status: "offline" };
          const rootValue = Object.fromEntries(
            Object.entries(options.resolvers).map(([name, fn]) => [
              name,
              (args: Record<string, any>) => fn(args, controller.signal),
            ]),
          );
          const result = await execute({
            schema,
            document,
            variableValues: variables,
            rootValue,
          });
          return result.errors
            ? {
                status: "unknown",
                reason:
                  "Remote execution failed; outcome requires reconciliation",
              }
            : { status: "committed", result };
        } catch (e) {
          return {
            status: "rejected",
            reason: "Remote operation rejected before execution",
          };
        }
      })();
      return {
        status: "pending",
        settled: Promise.race([work, cancelled]),
        cancel,
      };
    },
  };
}

/** One consumer interface; routing is declared at app construction, never guessed from online state. */
export function createApp(
  local: Store,
  remote: ReturnType<typeof createRemote>,
  operations: Record<string, import("./contracts.ts").OperationDefinition>,
): import("./contracts.ts").App {
  const declared = clone(operations);
  return {
    query: (s, v) => local.query(s, v),
    execute(name, variables) {
      const op = Object.hasOwn(declared, name) ? declared[name] : undefined;
      if (!op)
        return {
          status: "pending",
          settled: Promise.resolve({
            status: "rejected",
            reason: "Unknown declared operation",
          }),
          cancel() {},
        };
      if (op.location === "remote") return remote.execute(op.source, variables);
      const result = local.mutate(op.source, variables);
      return {
        status: "pending",
        settled: Promise.resolve({
          status: result.errors ? "rejected" : "committed",
          result,
        }),
        cancel() {},
      };
    },
  };
}
