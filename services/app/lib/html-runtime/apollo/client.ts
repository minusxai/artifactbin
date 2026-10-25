import {createQueryWatch} from './watch-query';
/**
 * `@afbin/apollo`: one client per page over one JSON document of local state
 * (a StatePort) and the page's backend namespaces (a RemotePort). Pure: the
 * core supplies the ports; this module never touches the DOM, network,
 * timers or storage.
 */
import { Kind, parse, print, valueFromASTUntyped, visit } from "graphql";
import type {
  ASTNode,
  DefinitionNode,
  DirectiveNode,
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
} from "graphql";
import type { HtmlJson as AfJson, HtmlJsonObject as AfJsonObject, PageMutationOutcome as Outcome } from "@artifactbin/contracts";
import { RemoteUnreachable } from "./apollo-contracts";
import { assertStorable, check } from "./storable";
import { decodeState, encodeState, readStateFragment, stateUrl } from "./state-url";

export { assertStorable, decodeState, encodeState, readStateFragment, stateUrl };
import type {
  AfClient,
  ClientOptions,
  LocalResolver,
  LocalResolvers,
  MutationResult,
  ObservableQuery,
  QueryResult,
  QueryInvalidation,
  RemotePort,
  ResultError,
  StatePort,
  StoreReceipt,
  StoreWrite,
  Variables,
} from "./apollo-contracts";

const DEFAULT_ATTEMPTS = 10;

/* ------------------------------------------------------------------ data */

/** A mutable deep copy of storable data. */
function clone<T extends AfJson | undefined>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function canonical(value: AfJson | undefined): string {
  if (value === undefined) return "u";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

const own = (document: AfJsonObject, key: string): AfJson | undefined =>
  Object.hasOwn(document, key) ? document[key] : undefined;

/* ------------------------------------------------------------------- gql */

const parsed = new WeakMap<TemplateStringsArray, DocumentNode>();

export function gql(strings: TemplateStringsArray, ...fragments: DocumentNode[]): DocumentNode {
  if (!fragments.length) {
    const cached = parsed.get(strings);
    if (cached) return cached;
  }
  let source = strings[0] ?? "";
  fragments.forEach((fragment, index) => {
    if (!fragment || fragment.kind !== Kind.DOCUMENT)
      throw new TypeError("gql substitutions must be gql documents (fragments)");
    source += print(fragment) + (strings[index + 1] ?? "");
  });
  const document = parse(source);
  const names = new Set<string>();
  const definitions: DefinitionNode[] = [];
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      if (names.has(definition.name.value)) continue;
      names.add(definition.name.value);
    }
    definitions.push(definition);
  }
  const result = Object.freeze({ ...document, definitions });
  if (!fragments.length) parsed.set(strings, result);
  return result;
}

/* ------------------------------------------------------------- documents */

class LocalError extends Error {}

interface Operation {
  node: OperationDefinitionNode;
  fragments: Map<string, FragmentDefinitionNode>;
  variables: Variables;
}

function operation(document: DocumentNode, variables: Variables | undefined): Operation {
  if (!document || document.kind !== Kind.DOCUMENT)
    throw new TypeError("Pass a document from gql`…`");
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  );
  if (operations.length !== 1) throw new LocalError("A document must hold exactly one operation");
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions)
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
  const node = operations[0]!;
  // A variable the caller leaves out takes its declared default.
  const merged: Variables = { ...(variables ?? {}) };
  for (const definition of node.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    if (definition.defaultValue && merged[name] === undefined) merged[name] = valueFromASTUntyped(definition.defaultValue) as AfJson;
  }
  return { node, fragments, variables: merged };
}

function included(node: { readonly directives?: readonly DirectiveNode[] }, variables: Variables): boolean {
  for (const directive of node.directives ?? []) {
    const name = directive.name.value;
    if (name !== "skip" && name !== "include") continue;
    const argument = directive.arguments?.find((item) => item.name.value === "if");
    const value = argument ? valueFromASTUntyped(argument.value, variables) === true : false;
    if (name === "skip" ? value : !value) return false;
  }
  return true;
}

/** Field selections in order, with fragments flattened and @skip/@include applied. */
function fieldsOf(selectionSet: SelectionSetNode, op: Operation, seen = new Set<string>()): FieldNode[] {
  const out: FieldNode[] = [];
  for (const selection of selectionSet.selections) {
    if (!included(selection, op.variables)) continue;
    if (selection.kind === Kind.FIELD) out.push(selection);
    else if (selection.kind === Kind.INLINE_FRAGMENT) out.push(...fieldsOf(selection.selectionSet, op, seen));
    else {
      const name = selection.name.value;
      const fragment = op.fragments.get(name);
      if (!fragment) throw new LocalError(`Unknown fragment ${name}`);
      if (seen.has(name)) continue;
      out.push(...fieldsOf(fragment.selectionSet, op, new Set([...seen, name])));
    }
  }
  return out;
}

const responseKey = (field: FieldNode) => field.alias?.value ?? field.name.value;

function shape(value: AfJson, selectionSet: SelectionSetNode, op: Operation, path: string): AfJson {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item, index) => shape(item, selectionSet, op, `${path}.${index}`));
  const out: AfJsonObject = {};
  for (const field of fieldsOf(selectionSet, op)) out[responseKey(field)] = project(own(value, field.name.value), field, op, `${path}.${responseKey(field)}`);
  return out;
}

/** A local field's value in the query's shape. */
function project(value: AfJson | undefined, field: FieldNode, op: Operation, path: string): AfJson {
  if (field.arguments?.length) throw new LocalError(`Local field ${path} takes no arguments`);
  if (value === undefined) return null;
  return field.selectionSet ? shape(value, field.selectionSet, op, path) : clone(value);
}

/** A document holding only `fields` (backend namespaces), with the variables and fragments they use. */
function subDocument(op: Operation, fields: FieldNode[]): { query: string; variables: Variables } {
  const usedVariables = new Set<string>();
  const usedFragments = new Set<string>();
  const walk = (nodes: readonly ASTNode[]) => {
    for (const node of nodes)
      visit(node, {
        Variable(variable) {
          usedVariables.add(variable.name.value);
        },
        FragmentSpread(spread) {
          const name = spread.name.value;
          if (usedFragments.has(name)) return;
          usedFragments.add(name);
          const fragment = op.fragments.get(name);
          if (fragment) walk([fragment]);
        },
      });
  };
  walk(fields);
  const node: OperationDefinitionNode = {
    ...op.node,
    variableDefinitions: (op.node.variableDefinitions ?? []).filter((definition) =>
      usedVariables.has(definition.variable.name.value),
    ),
    selectionSet: { kind: Kind.SELECTION_SET, selections: fields },
  };
  const document: DocumentNode = {
    kind: Kind.DOCUMENT,
    definitions: [node, ...[...op.fragments.values()].filter((fragment) => usedFragments.has(fragment.name.value))],
  };
  const variables: Variables = {};
  for (const name of usedVariables) if (Object.hasOwn(op.variables, name)) variables[name] = op.variables[name]!;
  return { query: print(document), variables };
}

/** Response paths of every mutation field inside the given namespaces: "billing.pay". */
function outcomeKeys(op: Operation, fields: FieldNode[]): string[] {
  const keys: string[] = [];
  for (const field of fields) {
    const children = field.selectionSet ? fieldsOf(field.selectionSet, op) : [];
    for (const child of children) keys.push(`${responseKey(field)}.${responseKey(child)}`);
  }
  return keys;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/* ---------------------------------------------------------------- client */

interface RemoteSettlement {
  data: AfJsonObject;
  errors: ResultError[];
  outcomes: Record<string, Outcome>;
}

async function runRemote(
  remote: RemotePort | undefined,
  op: Operation,
  fields: FieldNode[],
  kind: "query" | "mutation",
): Promise<RemoteSettlement> {
  const keys = fields.map(responseKey);
  const settled = (outcome: Outcome | null, reason: string): RemoteSettlement => {
    const data: AfJsonObject = {};
    for (const key of keys) data[key] = null;
    const outcomes: Record<string, Outcome> = {};
    if (outcome && kind === "mutation") for (const key of outcomeKeys(op, fields)) outcomes[key] = outcome;
    return { data, errors: keys.map((key) => ({ message: reason, path: [key] })), outcomes };
  };
  if (!remote) return settled("rejected", "This page has no backend connection");
  let execute:RemotePort['execute']=request=>remote.execute(request);
  if (!remote.online()) {
    if(kind!=="query"||!remote.whenReady)return settled("offline", "offline: nothing was sent");
    try{const ready=await remote.whenReady();if(!ready)return settled("offline", "offline: nothing was sent");execute=ready;}
    catch{return settled("offline", "offline: nothing was sent");}
  }
  const request = subDocument(op, fields);
  let reply: Awaited<ReturnType<RemotePort["execute"]>>;
  try {
    reply = await execute({ query: request.query, variables: request.variables, operation: kind });
  } catch (error) {
    if (error instanceof RemoteUnreachable) return settled("offline", "offline: nothing was sent");
    // Sent, then lost: the backend may have run it. Never retried.
    return settled("unknown", "Outcome unknown: " + message(error));
  }
  const data: AfJsonObject = {};
  for (const key of keys) data[key] = reply?.data && Object.hasOwn(reply.data, key) ? reply.data[key]! : null;
  const outcomes: Record<string, Outcome> = { ...(reply?.extensions?.outcomes ?? {}) };
  // A reply without data means the server refused the whole request before running any field.
  if (kind === "mutation")
    for (const key of outcomeKeys(op, fields)) outcomes[key] ??= reply?.data === null ? "rejected" : "unknown";
  return {
    data,
    errors: Array.isArray(reply?.errors) ? reply.errors : [],
    outcomes,
  };
}

export function createClient(options: ClientOptions): AfClient {
  const backendNames=options.backends;
  const backends=()=>new Set(typeof backendNames==='function'?backendNames():backendNames);
  const state: StatePort = options.state;
  const remote = options.remote;
  const maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be a positive integer");
  const resolvers = new Map<string, LocalResolver>();
  const invalidations=new Set<(reason?:QueryInvalidation)=>void>();let remoteWatches=0;
  const isBackend = (field: FieldNode) => backends().has(field.name.value);

  function localOnly(document: DocumentNode, variables: Variables | undefined, what: string) {
    const op = operation(document, variables);
    if (op.node.operation !== "query") throw new LocalError(`${what} takes a query`);
    const fields = fieldsOf(op.node.selectionSet, op);
    const remoteField = fields.find(isBackend);
    if (remoteField)
      throw new LocalError(`${what} works on local state only; ${remoteField.name.value} is a backend`);
    return { op, fields };
  }

  function read(fields: FieldNode[], op: Operation, document: AfJsonObject): AfJsonObject {
    const data: AfJsonObject = {};
    for (const field of fields) data[responseKey(field)] = project(own(document, field.name.value), field, op, responseKey(field));
    return data;
  }

  async function query<T>({ query: document, variables }: { query: DocumentNode; variables?: Variables }): Promise<QueryResult<T>> {
    let op: Operation;
    let fields: FieldNode[];
    try {
      op = operation(document, variables);
      if (op.node.operation !== "query") throw new LocalError("client.query takes a query; use client.mutate");
      fields = fieldsOf(op.node.selectionSet, op);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      return { data: {} as T, errors: [{ message: message(error) }] };
    }
    const data: AfJsonObject = {};
    const errors: ResultError[] = [];
    const current = state.read();
    const remoteFields: FieldNode[] = [];
    for (const field of fields) {
      const key = responseKey(field);
      data[key] = null;
      if (isBackend(field)) remoteFields.push(field);
      else
        try {
          data[key] = project(own(current, field.name.value), field, op, key);
        } catch (error) {
          errors.push({ message: message(error), path: [key] });
        }
    }
    if (remoteFields.length) {
      const settled = await runRemote(remote, op, remoteFields, "query");
      Object.assign(data, settled.data);
      errors.push(...settled.errors);
    }
    return errors.length ? { data: data as T, errors } : { data: data as T };
  }

  /** One compare-and-swap write, recomputed on conflict. */
  async function commit<R>(
    compute: (document: AfJsonObject) => { write: StoreWrite | null; result: R },
  ): Promise<{ result: R; document: AfJsonObject }> {
    let document = state.read();
    for (let attempt = 1; ; attempt++) {
      const { write, result } = compute(clone(document));
      if (!write) return { result, document: document };
      const receipt: StoreReceipt = await state.write(write);
      if (receipt.status === "committed") return { result, document: receipt.document };
      if (receipt.status === "rejected") throw new Error(receipt.error || "The change was rejected");
      if (attempt >= maxAttempts)
        throw new Error(`Conflict: the state kept changing; gave up after ${maxAttempts} attempts`);
      document = receipt.document;
    }
  }

  async function updateQuery<T>(
    { query: document, variables }: { query: DocumentNode; variables?: Variables },
    fn: (data: T) => T,
  ): Promise<T> {
    const { op, fields } = localOnly(document, variables, "updateQuery");
    if (typeof fn !== "function") throw new TypeError("updateQuery needs an update function");
    const named = new Map<string, string>();
    for (const field of fields) named.set(responseKey(field), field.name.value);
    const saved = (await commit((current) => {
      const data = read(fields, op, current);
      const returned = fn(data as T) as unknown;
      if (returned === null || typeof returned !== "object" || Array.isArray(returned))
        throw new TypeError("updateQuery's function must return an object in the query's shape");
      const expected: StoreWrite["expected"] = {};
      for (const name of named.values()) expected[name] = own(current, name);
      const next: StoreWrite["next"] = {};
      for (const [key, value] of Object.entries(returned)) {
        const name = named.get(key);
        if (name === undefined) throw new LocalError(`updateQuery returned ${key}, which its query does not name`);
        check(value, key, new Set());
        next[name] = clone(value as AfJson);
      }
      return { write: Object.keys(next).length ? { expected, next } : null, result: null };
    })).document;
    return read(fields, op, saved) as T;
  }

  async function runLocalMutation(field: FieldNode, op: Operation): Promise<AfJson> {
    const name = field.name.value;
    const resolver = resolvers.get(name);
    if (!resolver) throw new LocalError(`No local mutation named ${name}; register it with client.addResolvers`);
    const args: AfJsonObject = {};
    for (const argument of field.arguments ?? [])
      args[argument.name.value] = valueFromASTUntyped(argument.value, op.variables) as AfJson;
    check(args, "args", new Set());
    const { result } = await commit((current) => {
      const draft = clone(current);
      const returned = resolver(draft, clone(args)) as unknown;
      check(draft, "state", new Set());
      const value = returned === undefined ? null : (returned as AfJson);
      check(value, responseKey(field), new Set());
      const shaped = field.selectionSet ? shape(clone(value), field.selectionSet, op, responseKey(field)) : clone(value);
      const expected: StoreWrite["expected"] = {};
      const next: StoreWrite["next"] = {};
      for (const key of new Set([...Object.keys(current), ...Object.keys(draft)])) {
        const before = own(current, key);
        const after = own(draft, key);
        // The resolver saw the whole state, so any field changed meanwhile reruns it.
        expected[key] = before;
        if (canonical(before) !== canonical(after)) next[key] = after;
      }
      // It may also have read a field's absence, so one added meanwhile reruns it too.
      return { write: Object.keys(next).length ? { expected, next, exact: true } : null, result: shaped };
    });
    return result;
  }

  async function mutate<T>({ mutation, variables }: { mutation: DocumentNode; variables?: Variables }): Promise<MutationResult<T>> {
    let op: Operation;
    let fields: FieldNode[];
    try {
      op = operation(mutation, variables);
      if (op.node.operation !== "mutation") throw new LocalError("client.mutate takes a mutation");
      fields = fieldsOf(op.node.selectionSet, op);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      return { data: null, errors: [{ message: message(error) }] };
    }
    const data: AfJsonObject = {};
    const errors: ResultError[] = [];
    const outcomes: Record<string, Outcome> = {};
    let anyRemote = false;
    for (let index = 0; index < fields.length; ) {
      const field = fields[index]!;
      if (!isBackend(field)) {
        const key = responseKey(field);
        try {
          data[key] = await runLocalMutation(field, op);
        } catch (error) {
          data[key] = null;
          errors.push({ message: message(error), path: [key] });
        }
        index++;
        continue;
      }
      // Consecutive backend fields share one request.
      const group: FieldNode[] = [];
      while (index < fields.length && isBackend(fields[index]!)) group.push(fields[index++]!);
      anyRemote = true;
      const settled = await runRemote(remote, op, group, "mutation");
      Object.assign(data, settled.data);
      errors.push(...settled.errors);
      Object.assign(outcomes, settled.outcomes);
    }
    const result: MutationResult<T> = { data: data as T };
    if (errors.length) result.errors = errors;
    if (anyRemote) result.extensions = { outcomes };
    if(Object.values(outcomes).includes("committed"))for(const notify of [...invalidations])try{notify("data");}catch{/* A view failure cannot change a committed mutation outcome or skip other views. */}
    return result;
  }

  function watchQuery<T>({ query: document, variables,clearOnRefresh,preserveOnDataRefresh }: { query: DocumentNode; variables?: Variables;clearOnRefresh?:boolean;preserveOnDataRefresh?:boolean }): ObservableQuery<T> {
    const op=operation(document,variables);if(op.node.operation!=="query")throw new LocalError("watchQuery takes a query");
    const fields=fieldsOf(op.node.selectionSet,op),localFields=fields.filter(field=>!isBackend(field)),remoteFields=fields.filter(isBackend);
    const names=[...new Set(localFields.map(field=>field.name.value))];read(localFields,op,{});
    return createQueryWatch<T>({clearOnRefresh,preserveOnDataRefresh,state,signature:current=>names.map(name=>canonical(own(current,name))).join("\u0000"),local:current=>read(localFields,op,current),empty:Object.fromEntries(remoteFields.map(field=>[responseKey(field),null])),...(remoteFields.length?{remote:{
      acquire(){if(remoteWatches>=16)throw Error("Too many remote query subscriptions");remoteWatches++;return()=>{remoteWatches--;};},
      subscribe(notify:(reason?:QueryInvalidation)=>void){invalidations.add(notify);try{const stop=remote?.subscribe?.(notify);return()=>{invalidations.delete(notify);stop?.();};}catch(error){invalidations.delete(notify);throw error;}},
      async fetch(){const settled=await runRemote(remote,op,remoteFields,"query");return settled.errors.length?{data:settled.data,errors:settled.errors}:{data:settled.data};}
    }}:{})});
  }

  function addResolvers(more: LocalResolvers): void {
    for (const [name, resolver] of Object.entries(more?.Mutation ?? {})) {
      if (typeof resolver !== "function") throw new TypeError(`Resolver ${name} must be a function`);
      resolvers.set(name, resolver);
    }
  }

  return {
    query: query as AfClient["query"],
    mutate: mutate as AfClient["mutate"],
    watchQuery: watchQuery as AfClient["watchQuery"],
    updateQuery: updateQuery as AfClient["updateQuery"],
    addResolvers,
  };
}

/* ----------------------------------------------------------- local store */

export function createLocalStore(initial: AfJsonObject = {}): StatePort {
  check(initial, "state", new Set());
  if (initial === null || typeof initial !== "object" || Array.isArray(initial))
    throw new TypeError("Local state must be an object");
  let document: AfJsonObject = clone(initial);
  const listeners = new Set<(document: AfJsonObject) => void>();
  return {
    read: () => clone(document),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async write(change) {
      for (const [key, value] of Object.entries(change.expected))
        if (canonical(own(document, key)) !== canonical(value)) return { status: "conflict", document: clone(document) };
      if (change.exact)
        for (const key of Object.keys(document))
          if (!Object.hasOwn(change.expected, key)) return { status: "conflict", document: clone(document) };
      try {
        for (const [key, value] of Object.entries(change.next)) if (value !== undefined) check(value, key, new Set());
      } catch (error) {
        return { status: "rejected", document: clone(document), error: message(error) };
      }
      const updated: AfJsonObject = { ...document };
      for (const [key, value] of Object.entries(change.next)) {
        if (value === undefined) delete updated[key];
        else updated[key] = clone(value);
      }
      document = updated;
      for (const listener of [...listeners])
        try {
          listener(clone(document));
        } catch {
          /* One view cannot stop another from updating. */
        }
      return { status: "committed", document: clone(document) };
    },
  };
}
