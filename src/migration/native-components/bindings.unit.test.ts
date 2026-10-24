import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import { emitNativeBindings } from "./bindings.ts";
import type {
  NativeBindingsInput,
  NativeBindingTarget,
} from "./bindings-contracts.ts";
import type {
  NativeTypedAnalysis,
  RetainedJsxNode,
  NativeJson,
} from "./analyze-contracts.ts";
const digest = "a".repeat(64);
function input(
  nodes: RetainedJsxNode[],
  targets: NativeBindingTarget[],
): NativeBindingsInput {
  return {
    analysis: {
      key: { sourceNamespace: "synthetic", sourceId: "page", version: 1 },
      documentSha256: digest,
      sourceSha256: digest,
      analysisSha256: digest,
      compilerSourceSha256: digest,
      sourceSpans: [],
      nodes,
      flow: {
        imports: [],
        queries: [],
        mutations: [],
        values: [
          { name: "open", type: "boolean", default: false, start: 0, end: 1 },
          { name: "filter", type: "string", default: null, start: 0, end: 1 },
        ],
      },
    },
    targets,
    queries: [],
    mutations: [],
  };
}
function el(
  id: string,
  tag: string,
  attrs: Record<string, NativeJson> = {},
  control?: NativeJson,
): RetainedJsxNode {
  return {
    type: "element",
    graphKey: id,
    tag,
    isComponent: true,
    start: 0,
    end: 1,
    selfClosing: true,
    attributes: Object.entries(attrs).map(([name, json]) => ({
      name,
      value: { static: true, json },
      start: 0,
      end: 1,
    })),
    children: [],
    ...(control ? { control } : {}),
  };
}
class Element {
  attrs = new Map<string, string>();
  children: Element[] = [];
  parent: Element | null = null;
  content?: Element;
  listeners = new Map<string, Array<() => unknown>>();
  textContent = "";
  hidden = false;
  inert = false;
  disabled = false;
  tagName: string;
  constructor(tagName = "div", attrs: Record<string, string> = {}) {
    this.tagName = tagName;
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  get childNodes() {
    return this.children;
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  querySelectorAll(_selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(child.attrs.has("data-af-id") ||
      child.attrs.has("data-native-binding-id")
        ? [child]
        : []),
      ...child.querySelectorAll(_selector),
    ]);
  }
  append(...children: Element[]) {
    for (const child of children) {
      child.remove();
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: Element[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(
        (item) => item !== this,
      );
      this.parent = null;
    }
  }
  cloneNode(deep: boolean) {
    const clone = new Element(this.tagName, Object.fromEntries(this.attrs));
    clone.textContent = this.textContent;
    if (deep)
      clone.append(...this.children.map((child) => child.cloneNode(true)));
    return clone;
  }
  addEventListener(name: string, fn: () => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  removeEventListener(name: string, fn: () => unknown) {
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((item) => item !== fn),
    );
  }
  async click() {
    await Promise.all((this.listeners.get("click") ?? []).map((fn) => fn()));
  }
}
class Doc extends Element {
  body = new Element("body");
  templates = new Map<string, Element>();
  defaultView = { addEventListener() {} };
  constructor() {
    super("document");
    this.append(this.body);
  }
  createElement(tag: string) {
    return new Element(tag);
  }
  getElementById(id: string) {
    return this.templates.get(id) ?? null;
  }
  template(id: string, children: Element[]) {
    const value = new Element("template");
    value.content = new Element("fragment");
    value.content.append(...children);
    this.templates.set(id, value);
  }
}
function client(initial: Record<string, unknown>) {
  let state = { ...initial };
  const locals: Array<(value: { data: Record<string, unknown> }) => void> = [];
  const remotes: Array<{
    next: (value: unknown) => void;
    stopped: boolean;
    variables: unknown;
  }> = [];
  const writes: unknown[] = [];
  return {
    get state() {
      return state;
    },
    remotes,
    writes,
    watchQuery(options: { query: string; variables?: unknown }) {
      return {
        subscribe(next: (value: any) => void) {
          if (options.query.startsWith("query NativeLocal")) {
            locals.push(next);
            next({ data: state });
            return {
              unsubscribe() {
                locals.splice(locals.indexOf(next), 1);
              },
            };
          }
          const item = { next, stopped: false, variables: options.variables };
          remotes.push(item);
          return {
            unsubscribe() {
              item.stopped = true;
            },
          };
        },
      };
    },
    async updateQuery(_options: unknown, fn: (value: any) => any) {
      state = fn({ ...state });
      writes.push(state);
      for (const next of [...locals]) next({ data: state });
      return state;
    },
    async mutate(_options: unknown): Promise<any> {
      return { data: null, errors: [{ message: "rejected" }] };
    },
  };
}
async function execute(source: string, clientPort: unknown, document: Doc) {
  parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const root = await mkdtemp(path.join(tmpdir(), "native-binding-"));
  const key = "native-binding-test-" + root;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = clientPort;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  globals.document = document;
  try {
    const pkg = path.join(root, "node_modules/@afbin/apollo");
    await mkdir(pkg, { recursive: true });
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({ type: "module", exports: "./index.js" }),
    );
    await writeFile(
      path.join(pkg, "index.js"),
      `export const client=globalThis[${JSON.stringify(key)}];export const gql=strings=>strings.join('');`,
    );
    await writeFile(path.join(root, "page.mjs"), source);
    const module = await import(
      pathToFileURL(path.join(root, "page.mjs")).href
    );
    return {
      module,
      async close() {
        module.dispose();
        await rm(root, { recursive: true, force: true });
        if (previous) Object.defineProperty(globalThis, "document", previous);
        else delete globals.document;
        delete globals[key];
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globals.document;
    delete globals[key];
    throw error;
  }
}
const query = {
  name: "rows",
  namespace: "records",
  document:
    "query Rows($values:records__Values!,$only:[records__QueryName!]!){records{evaluate(values:$values,only:$only){tables{name error columns{name type} rows{cells{text number boolean isNull}}}}}}",
  values: [{ name: "filter", type: "string" }],
  tableName: "rows",
  responsePath: ["records", "evaluate", "tables"],
  decode: "registered-page-table-cells-v1" as const,
};
const answer = (id: string) => ({
  data: {
    records: {
      evaluate: {
        tables: [
          {
            name: "rows",
            error: null,
            columns: [
              { name: "id", type: "string" },
              { name: "title", type: "string" },
            ],
            rows: [
              {
                cells: [
                  { isNull: false, text: id },
                  { isNull: false, text: "Visible " + id },
                ],
              },
            ],
          },
        ],
      },
    },
  },
});
test("emitted ordinary module uses viewer local state and preserves stable conditional nodes across toggles", async () => {
  const source = input(
    [
      el("toggle", "Button", { set: { open: true } }),
      el(
        "branch",
        "div",
        {},
        { kind: "and", test: { kind: "signal", name: "open" } },
      ),
    ],
    [
      { kind: "action", sourceNode: "toggle", afId: "toggle" },
      {
        kind: "condition",
        sourceNode: "branch",
        afId: "branch",
        templateId: "branch-template",
      },
    ],
  );
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  assert.deepEqual({ ...result.localDefaults }, { open: false, filter: null });
  assert.doesNotMatch(result.authorJs, /eval\(|new Function|Solid|@mx/);
  const doc = new Doc(),
    toggle = new Element("button", { "data-af-id": "toggle" }),
    branch = new Element("div", { "data-af-id": "branch" });
  doc.body.append(toggle, branch);
  doc.template("branch-template", [
    new Element("p", { "data-af-id": "preserved" }),
  ]);
  const port = client({ open: false, filter: null });
  const runtime = await execute(result.authorJs, port, doc);
  try {
    await toggle.click();
    const mounted = branch.children[0];
    assert.ok(mounted);
    await port.updateQuery({}, (v) => ({ ...v, open: false }));
    await port.updateQuery({}, (v) => ({ ...v, open: true }));
    assert.equal(branch.children[0], mounted);
    assert.equal(port.state.open, true);
    assert.equal(port.remotes.length, 0);
  } finally {
    await runtime.close();
  }
});
test("emitted query subscriptions cancel stale responses and keyed rows keep supplied stable identities", async () => {
  const loop = el("loop", "For", { id: "loop", keyBy: "id" });
  if (loop.type !== "element") throw Error();
  loop.attributes.push({
    name: "each",
    start: 0,
    end: 1,
    value: {
      static: false,
      exprType: "Identifier",
      source: "$rows",
      reactive: { kind: "signal", name: "rows" },
    },
  });
  const text: RetainedJsxNode = {
    type: "expression",
    graphKey: "title",
    start: 0,
    end: 1,
    source: "$_row.title",
    value: {
      static: false,
      exprType: "MemberExpression",
      source: "$_row.title",
      reactive: { kind: "row", field: "title" },
    },
  };
  const source = input(
    [loop, text],
    [
      {
        kind: "loop",
        sourceNode: "loop",
        afId: "loop",
        templateId: "row-template",
        identity: {
          owner: "loop",
          keyBy: "id",
          templateIds: ["row-title", "row-label"],
          domIds: [{ domId: "authored-title", templateAfId: "row-title" }],
          encoding: "archived-instance-v1",
        },
      },
      { kind: "text", sourceNode: "title", afId: "row-title" },
    ],
  );
  source.queries = [query];
  source.analysis.flow.queries = [
    {
      name: "rows",
      sql: "PRIVATE_SQL_MUST_NOT_ENTER_OUTPUT",
      start: 0,
      end: 1,
    },
  ];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  assert.doesNotMatch(result.authorJs, /PRIVATE_SQL/);
  const doc = new Doc(),
    host = new Element("div", { "data-af-id": "loop" });
  doc.body.append(host);
  doc.template("row-template", [
    new Element("span", { "data-af-id": "row-title", id: "authored-title" }),
    new Element("label", {
      "data-af-id": "row-label",
      "aria-labelledby": "authored-title",
      for: "authored-title",
    }),
  ]);
  const port = client({ open: false, filter: null }),
    runtime = await execute(result.authorJs, port, doc);
  try {
    assert.equal(port.remotes.length, 1);
    port.remotes[0]!.next(answer("A"));
    const row = host.children[0]!,
      id = row.children[0]!.getAttribute("data-af-id");
    assert.match(id!, /^mx-instance-/);
    const domId = row.children[0]!.getAttribute("id");
    assert.notEqual(domId, "authored-title");
    assert.equal(row.children[1]!.getAttribute("aria-labelledby"), domId);
    assert.equal(row.children[1]!.getAttribute("for"), domId);
    assert.equal(row.children[0]!.textContent, "Visible A");
    await port.updateQuery({}, (v) => ({ ...v, filter: "next" }));
    assert.equal(port.remotes[0]!.stopped, true);
    port.remotes[0]!.next(answer("STALE"));
    assert.equal(host.children.length, 0);
    port.remotes[1]!.next(answer("A"));
    assert.equal(host.children[0]!.children[0]!.getAttribute("data-af-id"), id);
    assert.equal(port.state.rows, undefined);
    runtime.module.dispose();
    port.remotes[1]!.next(answer("late"));
    assert.equal(port.remotes[1]!.stopped, true);
  } finally {
    await runtime.close();
  }
});
test("missing identity plans, unsupported expression calls and missing registered mutations block emission", () => {
  const call: RetainedJsxNode = {
    type: "expression",
    graphKey: "expr",
    start: 0,
    end: 1,
    source: "danger()",
    value: { static: false, exprType: "CallExpression", source: "danger()" },
  };
  const source = input(
    [call, el("run", "Button", { run: "$save" })],
    [
      { kind: "text", sourceNode: "expr", afId: "expr" },
      { kind: "action", sourceNode: "run", afId: "run" },
    ],
  );
  const result = emitNativeBindings(source);
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.authorJs, null);
    assert.ok(result.blockers.some((b) => b.code === "unsupported-expression"));
    assert.ok(
      result.blockers.some((b) => b.code === "missing-mutation-descriptor"),
    );
  }
});

test("emitted Button run retains state on unknown/rejection, retries the original request and resets only committed values", async () => {
  const source = input(
    [el("save", "Button", { run: "$save" })],
    [{ kind: "action", sourceNode: "save", afId: "save" }],
  );
  source.analysis.flow.mutations = [{ name: "save", start: 0, end: 1 }];
  source.mutations = [
    {
      name: "save",
      document:
        "mutation Save($values:records__Values!,$requestId:String!){records{run(values:$values,requestId:$requestId){requestId outcome reset}}}",
      namespace: "records",
      values: [{ name: "filter", type: "string" }],
      outcomePath: ["records", "run"],
      reset: ["filter"],
    },
  ];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    button = new Element("button", { "data-af-id": "save" });
  doc.body.append(button);
  const port = client({ open: false, filter: "original" }),
    sent: any[] = [];
  let outcome = "unknown";
  port.mutate = async (options: any) => {
    sent.push(options.variables);
    return {
      data: {
        records: {
          run: {
            requestId: options.variables.requestId,
            outcome,
            reset: outcome === "committed" ? ["filter"] : [],
          },
        },
      },
    };
  };
  const runtime = await execute(result.authorJs, port, doc);
  try {
    await button.click();
    assert.equal(port.state.filter, "original");
    assert.equal(sent.length, 1);
    await port.updateQuery({}, (v) => ({ ...v, filter: "new edit" }));
    outcome = "committed";
    await button.click();
    assert.deepEqual(sent[1], sent[0]);
    assert.equal(port.state.filter, "new edit");
    await button.click();
    assert.notEqual(sent[2].requestId, sent[1].requestId);
    assert.equal(port.state.filter, null);
    await port.updateQuery({}, (v) => ({ ...v, filter: "keep" }));
    outcome = "rejected";
    await button.click();
    assert.equal(port.state.filter, "keep");
  } finally {
    await runtime.close();
  }
});
test("typed duplicate row keys fail visibly instead of silently changing annotation ownership", async () => {
  const loop = el("loop", "For", { id: "loop", keyBy: "id" });
  if (loop.type !== "element") throw Error();
  loop.attributes.push({
    name: "each",
    start: 0,
    end: 1,
    value: {
      static: false,
      exprType: "Identifier",
      source: "$rows",
      reactive: { kind: "signal", name: "rows" },
    },
  });
  const source = input(
    [loop],
    [
      {
        kind: "loop",
        sourceNode: "loop",
        afId: "loop",
        templateId: "rows",
        identity: {
          owner: "loop",
          keyBy: "id",
          templateIds: ["cell"],
          encoding: "archived-instance-v1",
        },
      },
    ],
  );
  source.queries = [query];
  source.analysis.flow.queries = [{ name: "rows", start: 0, end: 1 }];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    host = new Element("div", { "data-af-id": "loop" });
  doc.body.append(host);
  doc.template("rows", [new Element("span", { "data-af-id": "cell" })]);
  const port = client({ open: false, filter: null }),
    runtime = await execute(result.authorJs, port, doc);
  try {
    const repeated = answer("same");
    repeated.data.records.evaluate.tables[0]!.rows.push(
      repeated.data.records.evaluate.tables[0]!.rows[0]!,
    );
    port.remotes[0]!.next(repeated);
    assert.equal(host.children.length, 0);
    assert.ok(
      doc.body.children.some((node) => node.getAttribute("role") === "alert"),
    );
  } finally {
    await runtime.close();
  }
});

test("For without keyBy uses archived index DOM scopes without claiming durable row annotations", async () => {
  const loop = el("loop", "For", { id: "loop", className: "authored-grid" });
  if (loop.type !== "element") throw Error();
  loop.attributes.push({
    name: "each",
    start: 0,
    end: 1,
    value: {
      static: false,
      exprType: "Identifier",
      source: "$rows",
      reactive: { kind: "signal", name: "rows" },
    },
  });
  const text: RetainedJsxNode = {
    type: "expression",
    graphKey: "text",
    start: 0,
    end: 1,
    source: "$_row.title",
    value: {
      static: false,
      exprType: "MemberExpression",
      source: "$_row.title",
      reactive: { kind: "row", field: "title" },
    },
  };
  const source = input(
    [loop, text],
    [
      {
        kind: "loop",
        sourceNode: "loop",
        afId: "loop",
        templateId: "rows-template",
        identity: {
          owner: "loop",
          keyBy: null,
          templateIds: ["title"],
          domIds: [{ domId: "authored-title", templateAfId: "title" }],
          encoding: "archived-instance-v1",
        },
      },
      { kind: "text", sourceNode: "text", afId: "title" },
    ],
  );
  source.queries = [query];
  source.analysis.flow.queries = [{ name: "rows", start: 0, end: 1 }];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    host = new Element("div", {
      "data-af-id": "loop",
      class: "authored-grid",
      style: "display:contents",
    });
  doc.body.append(host);
  doc.template("rows-template", [
    new Element("span", { "data-af-id": "title", id: "authored-title" }),
  ]);
  const port = client({ open: false, filter: null }),
    runtime = await execute(result.authorJs, port, doc);
  try {
    port.remotes[0]!.next(answer("A"));
    const child = host.children[0]!.children[0]!;
    assert.equal(child.textContent, "Visible A");
    assert.equal(child.getAttribute("data-af-id"), null);
    assert.equal(
      child.getAttribute("id"),
      "mx-instance-" +
        encodeURIComponent(
          JSON.stringify([["repeat", "loop", "index", 0], "authored-title"]),
        ),
    );
    assert.equal(host.getAttribute("class"), "authored-grid");
    assert.equal(host.getAttribute("data-af-id"), "loop");
    port.remotes[0]!.next(answer("B"));
    assert.equal(host.children[0]!.children[0]!.textContent, "Visible B");
    assert.equal(
      host.children[0]!.children[0]!.getAttribute("data-af-id"),
      null,
    );
  } finally {
    await runtime.close();
  }
});
test("row-key field names follow retained nonempty-string grammar rather than identifier restrictions", () => {
  const loop = el("loop", "For", { id: "loop", keyBy: "Order ID" });
  if (loop.type !== "element") throw Error();
  loop.attributes.push({
    name: "each",
    start: 0,
    end: 1,
    value: {
      static: false,
      exprType: "Identifier",
      source: "$rows",
      reactive: { kind: "signal", name: "rows" },
    },
  });
  const source = input(
    [loop],
    [
      {
        kind: "loop",
        sourceNode: "loop",
        afId: "loop",
        templateId: "template",
        identity: {
          owner: "loop",
          keyBy: "Order ID",
          templateIds: ["cell"],
          encoding: "archived-instance-v1",
        },
      },
    ],
  );
  source.queries = [query];
  source.analysis.flow.queries = [{ name: "rows", start: 0, end: 1 }];
  assert.equal(emitNativeBindings(source).status, "complete");
});

test("retained reactive text prints strings and numbers but not booleans or null", async () => {
  const node: RetainedJsxNode = {
    type: "expression",
    graphKey: "flag",
    start: 0,
    end: 1,
    source: "$open",
    value: {
      static: false,
      exprType: "Identifier",
      source: "$open",
      reactive: { kind: "signal", name: "open" },
    },
  };
  const source = input(
    [node],
    [{ kind: "text", sourceNode: "flag", afId: "flag" }],
  );
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    host = new Element("span", { "data-af-id": "flag" });
  doc.body.append(host);
  const port = client({ open: false, filter: null }),
    runtime = await execute(result.authorJs, port, doc);
  try {
    assert.equal(host.textContent, "");
    await port.updateQuery({}, (value) => ({ ...value, open: true }));
    assert.equal(host.textContent, "");
  } finally {
    await runtime.close();
  }
});
