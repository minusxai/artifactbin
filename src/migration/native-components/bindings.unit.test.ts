import {buildNativeCellAdapter} from './cell-build.ts';
import type {NativeAssemblyFile} from './assemble-contracts.ts';
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
  listeners = new Map<string, Array<(event?: any) => unknown>>();
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
  addEventListener(name: string, fn: (event?: any) => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  removeEventListener(name: string, fn: (event?: any) => unknown) {
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((item) => item !== fn),
    );
  }
  async emit(name: string, value: unknown) {
    await Promise.all(
      (this.listeners.get(name) ?? []).map((fn) =>
        fn({
          target: this,
          currentTarget: this,
          detail: { value },
          preventDefault() {},
        }),
      ),
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
async function execute(source: string, clientPort: unknown, document: Doc,files:readonly NativeAssemblyFile[]=[]) {
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
    await writeFile(path.join(root, "package.json"), JSON.stringify({type:"module"}));
    for(const file of files){await mkdir(path.dirname(path.join(root,file.path)),{recursive:true});await writeFile(path.join(root,file.path),file.bytes);}
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

for (const keyed of [true, false])
  test(`lazy conditions inside ${keyed ? "keyed" : "positional"} repeats inherit row identity and IDREF mappings`, async () => {
    const loop = el("loop", "For", {
      id: "loop",
      ...(keyed ? { keyBy: "id" } : {}),
    });
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
    const condition = el(
      "condition",
      "__mx_condition",
      {},
      { kind: "and", test: { kind: "signal", name: "open" } },
    );
    const text: RetainedJsxNode = {
      type: "expression",
      graphKey: "name",
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
      [loop, condition, text],
      [
        {
          kind: "loop",
          sourceNode: "loop",
          afId: "loop",
          templateId: "row-shell",
          identity: {
            owner: "loop",
            keyBy: keyed ? "id" : null,
            templateIds: ["condition", "label", "name", "editor"],
            domIds: [{ domId: "label-dom", templateAfId: "label" }],
            encoding: "archived-instance-v1",
          },
        },
        {
          kind: "condition",
          sourceNode: "condition",
          afId: "condition",
          templateId: "lazy-branch",
        },
        { kind: "text", sourceNode: "name", afId: "name" },
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
    doc.template("row-shell", [
      new Element("span", { "data-af-id": "condition" }),
    ]);
    const label = new Element("label", {
      "data-af-id": "label",
      id: "label-dom",
    });
    label.append(new Element("span", { "data-af-id": "name" }));
    doc.template("lazy-branch", [
      label,
      new Element("input", {
        "data-af-id": "editor",
        "aria-labelledby": "label-dom",
      }),
    ]);
    const port = client({ open: false, filter: null }),
      runtime = await execute(result.authorJs, port, doc);
    try {
      const response = answer("A");
      response.data.records.evaluate.tables[0]!.rows.push(
        answer("B").data.records.evaluate.tables[0]!.rows[0]!,
      );
      port.remotes[0]!.next(response);
      assert.equal(host.children.length, 2);
      await port.updateQuery({}, (v) => ({ ...v, open: true }));
      const labels = host.children.map((row) => row.children[0]!.children[0]!);
      assert.deepEqual(
        labels.map((node) => node.children[0]!.textContent),
        ["Visible A", "Visible B"],
      );
      assert.equal(
        new Set(labels.map((node) => node.getAttribute("id"))).size,
        2,
      );
      for (const [index, row] of host.children.entries()) {
        const branch = row.children[0]!,
          label = branch.children[0]!,
          editor = branch.children[1]!,
          key = keyed ? (index === 0 ? "A" : "B") : index,
          scope = ["repeat", "loop", keyed ? "string" : "index", key];
        assert.equal(
          label.getAttribute("id"),
          "mx-instance-" +
            encodeURIComponent(JSON.stringify([scope, "label-dom"])),
        );
        assert.equal(
          editor.getAttribute("aria-labelledby"),
          label.getAttribute("id"),
        );
        assert.equal(
          label.getAttribute("data-af-id"),
          keyed
            ? "mx-instance-" +
                encodeURIComponent(JSON.stringify([scope, "label"]))
            : null,
        );
      }
      await port.updateQuery({}, (v) => ({ ...v, open: false }));
      assert.ok(
        host.children.every((row) => row.children[0]!.children.length === 0),
      );
      await port.updateQuery({}, (v) => ({ ...v, open: true }));
      assert.equal(host.children[0]!.children[0]!.children[0], labels[0]);
      assert.equal(
        doc.body.children.some((node) => node.getAttribute("role") === "alert"),
        false,
      );
    } finally {
      await runtime.close();
    }
  });

for (const [tag, property, type, next, expected] of [
  ["Input", "value", "string", "east", "east"],
  ["Textarea", "value", "string", "note", "note"],
  ["Select", "value", "number", "7", 7],
  ["Slider", "value", "number", 4, 4],
  ["Switch", "checked", "boolean", true, true],
  ["Dialog", "open", "boolean", true, true],
  ["Segmented", "value", "boolean", "true", true],
  ["DatePicker", "value", "date", "2026-01-02", "2026-01-02"],
] as const)
  test(`${tag} typed af-change writes viewer state and refreshes query variables`, async () => {
    const node = el("control", tag, { [property]: "$filter" });
    const source = input(
      [node],
      [
        {
          kind: "property",
          sourceNode: "control",
          afId: "control",
          property,
          attribute: property,
        },
      ],
    );
    source.analysis.flow.values[1]!.type = type;
    source.queries = [{ ...query, values: [{ name: "filter", type }] }];
    source.analysis.flow.queries = [{ name: "rows", start: 0, end: 1 }];
    const result = emitNativeBindings(source);
    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;
    const doc = new Doc(),
      host = new Element("af-control", { "data-af-id": "control" });
    doc.body.append(host);
    const port = client({ open: false, filter: null }),
      runtime = await execute(result.authorJs, port, doc);
    try {
      await host.emit("af-change", next);
      assert.equal(port.state.filter, expected);
      assert.equal(port.remotes[0]!.stopped, true);
      assert.deepEqual(port.remotes.at(-1)!.variables, {
        values: { filter: expected },
        only: ["rows"],
      });
    } finally {
      await runtime.close();
    }
  });
test("dynamic control expressions must be assignable scalar declarations", () => {
  const node = el("control", "Input");
  if (node.type !== "element") throw Error();
  node.attributes.push({
    name: "value",
    start: 0,
    end: 1,
    value: {
      static: false,
      exprType: "UnaryExpression",
      source: "!$open",
      reactive: { kind: "not", value: { kind: "signal", name: "open" } },
    },
  });
  const result = emitNativeBindings(
    input(
      [node],
      [
        {
          kind: "property",
          sourceNode: "control",
          afId: "control",
          property: "value",
          attribute: "value",
        },
      ],
    ),
  );
  assert.equal(result.status, "blocked");
  if (result.status === "blocked")
    assert.ok(
      result.blockers.some(
        (blocker) => blocker.code === "nonassignable-control-binding",
      ),
    );
});

for (const [tag, event] of [
  ["input", "input"],
  ["textarea", "input"],
  ["select", "change"],
] as const)
  test(`native ${tag} writes on its actual ${event} event and empty input becomes null`, async () => {
    const source = input(
      [el("field", tag, { value: "$filter" })],
      [
        {
          kind: "property",
          sourceNode: "field",
          afId: "field",
          property: "value",
          attribute: "value",
        },
      ],
    );
    const result = emitNativeBindings(source);
    assert.equal(result.status, "complete");
    if (result.status !== "complete") return;
    const doc = new Doc(),
      host = new Element(tag, { "data-af-id": "field" });
    doc.body.append(host);
    const port = client({ open: false, filter: null }),
      runtime = await execute(result.authorJs, port, doc);
    try {
      (host as any).value = "typed";
      await host.emit(event, undefined);
      assert.equal(port.state.filter, "typed");
      (host as any).value = "";
      await host.emit(event, undefined);
      assert.equal(port.state.filter, null);
    } finally {
      await runtime.close();
    }
  });

test("repeat eviction disposes listeners, pending actions and cached row state", async () => {
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
    [loop, el("save", "Button", { run: "$save" })],
    [
      {
        kind: "loop",
        sourceNode: "loop",
        afId: "loop",
        templateId: "rows",
        identity: {
          owner: "loop",
          keyBy: "id",
          templateIds: ["save"],
          encoding: "archived-instance-v1",
        },
      },
      { kind: "action", sourceNode: "save", afId: "save" },
    ],
  );
  source.queries = [query];
  source.analysis.flow.queries = [{ name: "rows", sql: "", start: 0, end: 1 }];
  source.analysis.flow.mutations = [{ name: "save", start: 0, end: 1 }];
  source.mutations = [
    {
      name: "save",
      namespace: "records",
      document:
        "mutation Save($values:records__Values!,$requestId:String!){records{run(values:$values,requestId:$requestId){requestId outcome reset}}}",
      values: [{ name: "filter", type: "string" }],
      outcomePath: ["records", "run"],
      reset: ["filter"],
    },
  ];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    host = new Element("div", { "data-af-id": "loop" });
  doc.body.append(host);
  doc.template("rows", [new Element("button", { "data-af-id": "save" })]);
  const port = client({ open: false, filter: "keep" });
  let calls = 0,
    release: () => void = () => {};
  port.mutate = async (options: any) => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      data: {
        records: {
          run: {
            requestId: options.variables.requestId,
            outcome: "committed",
            reset: ["filter"],
          },
        },
      },
    };
  };
  const runtime = await execute(result.authorJs, port, doc);
  try {
    port.remotes[0]!.next(answer("A"));
    const old = host.children[0]!.children[0]!;
    const pendingClick = old.click();
    port.remotes[0]!.next(answer("B"));
    assert.equal(old.listeners.get("click")?.length, 0);
    release();
    await pendingClick;
    assert.equal(port.state.filter, "keep");
    await old.click();
    assert.equal(calls, 1);
    for (let i = 0; i < 1000; i++) {
      const previous = host.children[0]!.children[0]!;
      port.remotes[0]!.next(answer(String(i)));
      assert.equal(previous.listeners.get("click")?.length, 0);
    }
    port.remotes[0]!.next(answer("A"));
    assert.notEqual(host.children[0]!.children[0], old);
    const current = host.children[0]!.children[0]!;
    runtime.module.dispose();
    assert.equal(current.listeners.get("click")?.length, 0);
  } finally {
    await runtime.close();
  }
});

test("top-level buttons share an operation busy lock before awaiting local writes", async () => {
  const source = input(
    [el("a", "Button", { run: "$save" }), el("b", "Button", { run: "$save" })],
    [
      { kind: "action", sourceNode: "a", afId: "a" },
      { kind: "action", sourceNode: "b", afId: "b" },
    ],
  );
  source.analysis.flow.mutations = [{ name: "save", start: 0, end: 1 }];
  source.mutations = [
    {
      name: "save",
      namespace: "records",
      document:
        "mutation Save($values:records__Values!,$requestId:String!){records{run(values:$values,requestId:$requestId){requestId outcome reset}}}",
      values: [],
      outcomePath: ["records", "run"],
      reset: [],
    },
  ];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    a = new Element("button", { "data-af-id": "a" }),
    b = new Element("button", { "data-af-id": "b" });
  doc.body.append(a, b);
  const port = client({ open: false, filter: null });
  let calls = 0,
    release: () => void = () => {};
  port.mutate = async (options: any) => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      data: {
        records: {
          run: {
            requestId: options.variables.requestId,
            outcome: "committed",
            reset: [],
          },
        },
      },
    };
  };
  const runtime = await execute(result.authorJs, port, doc);
  try {
    const first = a.click();
    assert.equal(b.disabled, true);
    await b.click();
    assert.equal(calls, 1);
    release();
    await first;
    assert.equal(b.disabled, false);
    const next = b.click();
    assert.equal(calls, 2);
    release();
    await next;
  } finally {
    await runtime.close();
  }
});

test("same mutation remains independently runnable in different stable rows with exact admitted row arguments", async () => {
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
    [loop, el("save", "Button", { run: "$save" })],
    [
      {
        kind: "loop",
        sourceNode: "loop",
        afId: "loop",
        templateId: "rows",
        identity: {
          owner: "loop",
          keyBy: "id",
          templateIds: ["save"],
          encoding: "archived-instance-v1",
        },
      },
      { kind: "action", sourceNode: "save", afId: "save" },
    ],
  );
  source.queries = [query];
  source.analysis.flow.queries = [{ name: "rows", sql: "", start: 0, end: 1 }];
  source.analysis.flow.mutations = [{ name: "save", start: 0, end: 1 }];
  source.mutations = [
    {
      name: "save",
      namespace: "records",
      document:
        "mutation Save($values:records__Values!,$requestId:String!){records{run(values:$values,requestId:$requestId){requestId outcome reset}}}",
      values: [{name:"row_id",type:"string",source:{kind:"row",field:"id"}}],
      outcomePath: ["records", "run"],
      reset: [],
    },
  ];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    host = new Element("div", { "data-af-id": "loop" });
  doc.body.append(host);
  doc.template("rows", [new Element("button", { "data-af-id": "save" })]);
  const port = client({ open: false, filter: null }),
    releases: (() => void)[] = [],
    requests: any[] = [];
  port.mutate = async (options: any) => {
    requests.push(options.variables);
    await new Promise<void>((resolve) => releases.push(resolve));
    return {
      data: {
        records: {
          run: {
            requestId: options.variables.requestId,
            outcome: "committed",
            reset: [],
          },
        },
      },
    };
  };
  const runtime = await execute(result.authorJs, port, doc);
  try {
    const data = answer("A");
    data.data.records.evaluate.tables[0]!.rows.push(
      answer("B").data.records.evaluate.tables[0]!.rows[0]!,
    );
    port.remotes[0]!.next(data);
    const a = host.children[0]!.children[0]!,
      b = host.children[1]!.children[0]!;
    const first = a.click(),
      second = b.click();
    await a.click();
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].requestId, requests[1].requestId);
    for (const release of releases) release();
    await Promise.all([first, second]);
    assert.deepEqual(requests.map(request=>request.values.row_id), ["A", "B"]);
  } finally {
    await runtime.close();
  }
});

test("Dialog af-change closes and reopens the same viewer-owned boolean binding", async () => {
  const source = input(
    [el("dialog", "Dialog", { open: "$open" })],
    [
      {
        kind: "property",
        sourceNode: "dialog",
        afId: "dialog",
        property: "open",
        attribute: "open",
      },
    ],
  );
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    host = new Element("af-dialog", { "data-af-id": "dialog" });
  doc.body.append(host);
  const port = client({ open: false, filter: null }),
    runtime = await execute(result.authorJs, port, doc);
  try {
    for (const next of [true, false, true]) {
      await host.emit("af-change", next);
      assert.equal(port.state.open, next);
      assert.equal((host as any).open, next);
    }
    runtime.module.dispose();
    await host.emit("af-change", false);
    assert.equal(port.state.open, true);
  } finally {
    await runtime.close();
  }
  source.analysis.flow.values[0]!.type = "string";
  assert.equal(emitNativeBindings(source).status, "blocked");
});

test("chart data targets project declared query TableData without persisting shared tables locally", async () => {
  const source = input(
    [el("chart", "LayeredVegaLite", { data: "$rows" })],
    [
      {
        kind: "property",
        sourceNode: "chart",
        afId: "chart",
        property: "data",
        attribute: "data",
      },
    ],
  );
  source.queries = [query];
  source.analysis.flow.queries = [{ name: "rows", start: 0, end: 1 }];
  const result = emitNativeBindings(source);
  assert.equal(result.status, "complete");
  if (result.status !== "complete") return;
  const doc = new Doc(),
    host = new Element("div", { "data-af-id": "chart" });
  doc.body.append(host);
  const port = client({ open: false, filter: null }),
    runtime = await execute(result.authorJs, port, doc);
  try {
    assert.equal((host as any).data, null);
    port.remotes[0]!.next(answer("A"));
    assert.deepEqual((host as any).data.columns, [
      { name: "id", type: "string" },
      { name: "title", type: "string" },
    ]);
    assert.equal((host as any).data.rows[0].title, "Visible A");
    assert.equal(port.state.rows, undefined);
    await port.updateQuery({}, (v) => ({ ...v, filter: "next" }));
    assert.equal((host as any).data, null);
    port.remotes[0]!.next(answer("stale"));
    assert.equal((host as any).data, null);
    const empty = answer("B");
    empty.data.records.evaluate.tables[0]!.rows = [];
    port.remotes[1]!.next(empty);
    assert.deepEqual((host as any).data.rows, []);
  } finally {
    await runtime.close();
  }
  const invalid = input(
    [el("chart", "LayeredVegaLite", { data: "$filter" })],
    [
      {
        kind: "property",
        sourceNode: "chart",
        afId: "chart",
        property: "data",
        attribute: "data",
      },
    ],
  );
  assert.equal(emitNativeBindings(invalid).status, "blocked");
});

test("historical readonly actions stay disabled while local-only actions remain interactive", async () => {
 const nodes=[el('save','Button',{run:'$save'}),el('local','Button',{set:{open:true}})];
 const source=input(nodes,[{kind:'action',sourceNode:'save',afId:'save'},{kind:'action',sourceNode:'local',afId:'local'}]);
 source.analysis.flow.mutations=[{name:'save',start:0,end:1}];source.mutations=[{name:'save',mode:'historical-readonly'}];
 const result=emitNativeBindings(source);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 const doc=new Doc(),body=doc.body,save=new Element('button',{'data-af-id':'save'}),local=new Element('button',{'data-af-id':'local'});body.append(save,local);
 const port=client({open:false,filter:null});port.mutate=async()=>{throw Error('Readonly action reached remote');};
 const running=await execute(result.authorJs,port,doc);
 assert.equal(save.disabled,true);await save.click();await local.click();assert.equal(port.state.open,true);
 await running.close();
});

test("registered mutation snapshots admitted row fields separately from viewer local scalars", async () => {
 const source=input([el('save','Button',{run:'$save'})],[{kind:'action',sourceNode:'save',afId:'save'}]);
 source.analysis.flow.mutations=[{name:'save',start:0,end:1}];
 source.mutations=[{name:'save',namespace:'records',document:'mutation Save($values:records__Values!,$requestId:String!){records{run(values:$values,requestId:$requestId){requestId outcome reset}}}',values:[{name:'row_id',type:'string',nullable:true,source:{kind:'row',field:'id'}},{name:'filter',type:'string',nullable:true}],outcomePath:['records','run'],reset:[]}];
 const result=emitNativeBindings(source);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 const doc=new Doc(),button=new Element('button',{'data-af-id':'save'});doc.body.append(button);
 const port=client({open:false,filter:'local'});let request:any;
 port.mutate=async(options:any)=>{request=options.variables;return {data:{records:{run:{requestId:request.requestId,outcome:'committed',reset:[]}}}};};
 const running=await execute(result.authorJs,port,doc);
 try {await button.click();assert.deepEqual(request.values,{row_id:null,filter:'local'});assert.equal(Object.hasOwn(port.state,'row_id'),false);} finally {await running.close();}
});

test("HTTP preview mutations use cryptographic UUIDs and preserve unknown retry identity", async () => {
 const source=input([el('save','Button',{run:'$save'})],[{kind:'action',sourceNode:'save',afId:'save'}]);
 source.analysis.flow.mutations=[{name:'save',start:0,end:1}];
 source.mutations=[{name:'save',namespace:'records',document:'mutation Save($values:records__Values!,$requestId:String!){records{run(values:$values,requestId:$requestId){requestId outcome reset}}}',values:[{name:'row_id',type:'string',nullable:true,source:{kind:'row',field:'id'}},{name:'filter',type:'string',nullable:true}],outcomePath:['records','run'],reset:[]}];
 const result=emitNativeBindings(source);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 const doc=new Doc(),button=new Element('button',{'data-af-id':'save'});doc.body.append(button);
 const port=client({open:false,filter:'local'});let request:any;const requests:any[]=[];
 port.mutate=async(options:any)=>{request=options.variables;requests.push(request);return {data:{records:{run:{requestId:request.requestId,outcome:requests.length===1?'unknown':'committed',reset:[]}}}};};
 const previous=Object.getOwnPropertyDescriptor(globalThis,'crypto');let entropyCalls=0;Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:(bytes:Uint8Array)=>{entropyCalls++;return bytes.fill(255);}}});
 const running=await execute(result.authorJs,port,doc);
 try {await button.click();await button.click();assert.equal(requests.length,2);assert.equal(entropyCalls,1);assert.match(request.requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(requests[0].requestId,requests[1].requestId);assert.deepEqual(request.values,{row_id:null,filter:'local'});} finally {await running.close();if(previous)Object.defineProperty(globalThis,'crypto',previous);else delete (globalThis as any).crypto;}
});


test('dynamic Cell updates from registered tables, retains figure only while explicitly pending, and clears unavailable answers',async()=>{
 const bundled=await buildNativeCellAdapter();
 const source=input([el('figure','Cell',{data:'$rows',col:'n',className:'author-number',prefix:'$'})],[{kind:'cell',sourceNode:'figure',afId:'figure',attribute:'data'}]);source.queries=[query];source.analysis.flow.queries=[{name:'rows',start:0,end:1}];source.cellAdapter=bundled.adapter;
 const emitted=emitNativeBindings(source);assert.equal(emitted.status,'complete');if(emitted.status!=='complete')return;
 const doc=new Doc(),host=new Element('span',{'data-af-id':'figure',class:'author-number'});doc.body.append(host);const port=client({filter:null,open:false}),running=await execute(emitted.authorJs,port,doc,bundled.files);
 const remote=port.remotes[0]!;
 try{
  assert.equal(host.getAttribute('aria-busy'),'true');assert.equal(host.children[0]!.textContent,'—');
  remote.next({data:{records:{evaluate:{tables:[{name:'rows',error:null,columns:[{name:'n',type:'number'}],rows:[{cells:[{isNull:false,number:12345.678}]}]}]}}},loading:false});
  assert.equal(host.children[0]!.textContent,'$'+new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(12345.678));assert.equal(host.getAttribute('class'),'author-number');assert.equal(host.children[0]!.getAttribute('aria-label'),'Live number');
  remote.next({data:{records:null},loading:true});assert.equal(host.getAttribute('aria-busy'),'true');assert.equal(host.getAttribute('class'),'mx-busy-inline');assert.notEqual(host.children[0]!.textContent,'—');
  remote.next({data:{records:null},loading:false});assert.equal(host.children[0]!.textContent,'—');assert.equal(host.getAttribute('aria-busy'),'false');assert.equal(host.getAttribute('class'),'author-number');assert.equal(host.children[0]!.getAttribute('aria-label'),'Number placeholder');
 }finally{await running.close();}
});
test('Cell target refuses an undeclared data query, dynamic format and missing adapter',()=>{
 const node=el('figure','Cell',{data:'$unknown',col:'n'}),source=input([node],[{kind:'cell',sourceNode:'figure',afId:'figure',attribute:'data'}]);
 const missing=emitNativeBindings(source);assert.equal(missing.status,'blocked');assert.ok(missing.blockers.some(b=>b.code==='cell-formatter-adapter-required'));assert.ok(missing.blockers.some(b=>b.code==='cell-target-needs-declared-query'));
 if(node.type!=="element")throw Error('fixture');
 node.attributes.push({name:'format',start:0,end:1,value:{static:false,source:'$filter',exprType:'Identifier'}});source.queries=[query];source.analysis.flow.queries=[{name:'rows',start:0,end:1}];node.attributes[0]!.value={static:true,json:'$rows'};source.cellAdapter={specifier:'./components/native-cell.js',sha256:'a'.repeat(64)};
 const dynamic=emitNativeBindings(source);assert.ok(dynamic.blockers.some(b=>b.code==='invalid-cell-format-property'));
});
test("explicit remote viewer identity controls conditions without being persisted as viewer local state", async () => {
 const source=input([el('branch','div',{}, {kind:'and',test:{kind:'signal',name:'_me.id'}}),el('guest','div',{}, {kind:'and',test:{kind:'not',value:{kind:'signal',name:'_me.id'}}})],[{kind:'condition',sourceNode:'branch',afId:'branch',templateId:'signed-in'},{kind:'condition',sourceNode:'guest',afId:'guest',templateId:'signed-out'}]);
 source.viewer={namespace:'queries',identity:'target-subject-v1',document:'query NativeViewer{queries{viewer{id}}}',responsePath:['queries','viewer','id']};
 const result=emitNativeBindings(source);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 const doc=new Doc(),branch=new Element('div',{'data-af-id':'branch'}),guest=new Element('div',{'data-af-id':'guest'});doc.body.append(branch,guest);doc.template('signed-in',[new Element('p')]);doc.template('signed-out',[new Element('p')]);
 const port=client({open:false,filter:null}),running=await execute(result.authorJs,port,doc);
 try {assert.equal(branch.children.length,0);assert.equal(guest.children.length,0);const viewer=port.remotes.find(r=>(r as any).variables===undefined)!;assert.ok(viewer);
 viewer.next({data:{queries:{viewer:{id:'target-user'}}}});assert.equal(branch.children.length,1);
 assert.deepEqual(port.state,{open:false,filter:null});
 viewer.next({data:{queries:{viewer:{id:null}}}});assert.equal(branch.children.length,0);assert.equal(guest.children.length,1);
 viewer.next({data:{queries:{viewer:{}}}});assert.equal(branch.children.length,0);assert.equal(guest.children.length,0);
 viewer.next({data:{queries:{viewer:{id:'target-user'}}}});assert.equal(branch.children.length,1);
 running.module.dispose();viewer.next({data:{queries:{viewer:{id:null}}}});assert.equal(branch.children.length,1);assert.equal(viewer.stopped,true);
 }finally{await running.close();}
});

test('viewer pending and signout dispose cached branch actions, then restore the same subtree safely',async()=>{
 const branch=el('branch','div',{}, {kind:'and',test:{kind:'signal',name:'_me.id'}}),action=el('action','Button',{set:{open:true}});
 if(branch.type!=='element')throw Error();branch.children=[action];
 const source=input([branch],[{kind:'condition',sourceNode:'branch',afId:'branch',templateId:'signed-in'},{kind:'action',sourceNode:'action',afId:'action'}]);
 source.viewer={namespace:'queries',identity:'target-subject-v1',document:'query NativeViewer{queries{viewer{id}}}',responsePath:['queries','viewer','id']};
 const result=emitNativeBindings(source);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 const doc=new Doc(),host=new Element('div',{'data-af-id':'branch'});doc.body.append(host);doc.template('signed-in',[new Element('button',{'data-af-id':'action'})]);
 const port=client({open:false,filter:null}),running=await execute(result.authorJs,port,doc),viewer=port.remotes[0]!;
 try{
 viewer.next({data:{queries:{viewer:{id:'target-user'}}}});const cached=host.children[0]!;assert.ok(cached);
 viewer.next({data:{queries:null}});assert.equal(host.children.length,0);await cached.click();assert.equal(port.state.open,false);
 viewer.next({data:{queries:{viewer:{id:'target-user'}}}});assert.equal(host.children[0],cached);await cached.click();assert.equal(port.state.open,true);
 await port.updateQuery({},v=>({...v,open:false}));viewer.next({data:{queries:{viewer:{id:null}}}});await cached.click();assert.equal(port.state.open,false);
 viewer.next({data:{queries:{viewer:{id:'target-user'}}}});assert.equal(host.children[0],cached);const before=port.writes.length;await cached.click();assert.equal(port.state.open,true);assert.equal(port.writes.length,before+1);
 }finally{await running.close();}
});

test('unknown mutation keeps its request identity through temporary viewer branch removal and refuses another subject',async()=>{
 const branch=el('branch','div',{}, {kind:'and',test:{kind:'signal',name:'_me.id'}});if(branch.type!=='element')throw Error();branch.children=[el('save','Button',{run:'$save'})];
 const source=input([branch],[{kind:'condition',sourceNode:'branch',afId:'branch',templateId:'signed-in'},{kind:'action',sourceNode:'save',afId:'save'}]);
 source.analysis.flow.mutations=[{name:'save',start:0,end:1}];source.viewer={namespace:'queries',identity:'target-subject-v1',document:'query NativeViewer{queries{viewer{id}}}',responsePath:['queries','viewer','id']};
 source.mutations=[{name:'save',namespace:'records',document:'mutation Save($values:records__Values!,$requestId:String!){records{run(values:$values,requestId:$requestId){requestId outcome reset}}}',values:[{name:'filter',type:'string',nullable:true}],outcomePath:['records','run'],reset:[]}];
 const result=emitNativeBindings(source);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 const doc=new Doc(),host=new Element('div',{'data-af-id':'branch'});doc.body.append(host);doc.template('signed-in',[new Element('button',{'data-af-id':'save'})]);
 const port=client({open:false,filter:'original'}),requests:any[]=[];let release:(value:unknown)=>void=()=>{};
 port.mutate=async(options:any)=>{requests.push(options.variables);if(requests.length===1)return await new Promise(resolve=>release=resolve);return {data:{records:{run:{requestId:options.variables.requestId,outcome:'committed',reset:[]}}}};};
 const running=await execute(result.authorJs,port,doc),viewer=port.remotes[0]!;
 try {viewer.next({data:{queries:{viewer:{id:'first-user'}}}});const button=host.children[0]!,first=button.click();await Promise.resolve();assert.equal(requests.length,1);
 viewer.next({data:{queries:null}});release({data:{records:{run:{requestId:requests[0].requestId,outcome:'unknown',reset:[]}}}});await first;
 viewer.next({data:{queries:{viewer:{id:'second-user'}}}});await button.click();assert.equal(requests.length,1);
 viewer.next({data:{queries:null}});viewer.next({data:{queries:{viewer:{id:'first-user'}}}});await port.updateQuery({},v=>({...v,filter:'changed'}));await button.click();assert.equal(requests.length,2);assert.equal(requests[1].requestId,requests[0].requestId);assert.deepEqual(requests[1].values,{filter:'original'});
 }finally{await running.close();}
});

test('person binding follows exact typed row ID and clears stale, missing and error cards on scope disposal',async()=>{
 const person=el('person','User',{userId:'$_row.owner'}),loop=el('loop','For',{each:'$rows',id:'rows',keyBy:'id'});
 if(loop.type!=='element')throw Error();loop.children=[person];loop.attributes.find(a=>a.name==='each')!.value={static:false,exprType:'reference',source:'$rows'};
 const source=input([loop],[{kind:'loop',sourceNode:'loop',afId:'loop',templateId:'items',identity:{owner:'rows',keyBy:'id',templateIds:['person'],encoding:'archived-instance-v1'}},{kind:'person',sourceNode:'person',afId:'person',attribute:'userId'}]);
 source.analysis.flow.values=[];source.analysis.flow.queries=[{name:'rows',sql:'select 1',start:0,end:1} as never];
 source.queries=[{name:'rows',document:'query { registered { evaluate { tables { name } } } }',namespace:'registered',values:[],tableName:'rows',responsePath:['registered','evaluate','tables'],decode:'registered-page-table-cells-v1'}];
 source.people={namespace:'peopleData',authority:'linked-dataset-typed-user-v1',datasetRef:'ref:dataset',mode:'live'};
 const result=emitNativeBindings(source);assert.equal(result.status,'complete',JSON.stringify(result.blockers));if(result.status!=='complete')return;
 const doc=new Doc(),list=new Element('div',{'data-af-id':'loop'});doc.body.append(list);doc.template('items',[new Element('af-user',{'data-af-id':'person'})]);
 const port=client({});const module=await execute(result.authorJs,port,doc);
 const publish=(rows:unknown[])=>port.remotes[0]!.next({data:{registered:{evaluate:{tables:[{name:'rows',error:null,columns:[{name:'id',type:'string'},{name:'owner',type:'user'}],rows:rows.map(row=>({cells:(row as string[]).map(text=>({isNull:false,text}))}))}]}}}});
 publish([['r','usr_one']]);await Promise.resolve();const host=list.children[0]!.children[0]! as any;
 assert.deepEqual(port.remotes[1]!.variables,{ids0:['usr_one']});assert.equal(host.loading,true);
 port.remotes[1]!.next({data:{peopleData:{people:[{id:'usr_one',name:'Actual profile',handle:null,image:null}]}}});assert.equal(host.person.name,'Actual profile');
 publish([['r','usr_two']]);await Promise.resolve();assert.equal(port.remotes[1]!.stopped,true);assert.equal(host.person,null);
 port.remotes[1]!.next({data:{peopleData:{people:[{id:'usr_one',name:'Stale profile',handle:null,image:null}]}}});assert.equal(host.person,null);
 port.remotes[2]!.next({data:{peopleData:{people:[]}}});assert.equal(host.identityState,'missing');assert.equal(host.person,null);
 publish([['r','usr_three']]);await Promise.resolve();port.remotes[3]!.next({errors:[{message:'forbidden'}]});assert.equal(host.error,'Person unavailable');assert.equal(host.person,null);
 publish([]);assert.equal(port.remotes[3]!.stopped,true);await module.close();
});

test('person viewer binding waits for authenticated identity and clears cards during viewer changes',async()=>{
 const source=input([el('person','User',{userId:'$_me.id'})],[{kind:'person',sourceNode:'person',afId:'person',attribute:'userId'}]);
 source.analysis.flow.values=[];source.viewer={namespace:'identity',identity:'target-subject-v1',document:'query {identity{viewer{id}}}',responsePath:['identity','viewer','id']};
 source.people={namespace:'peopleData',authority:'linked-dataset-typed-user-v1',datasetRef:'ref:dataset',mode:'live'};
 const result=emitNativeBindings(source);assert.equal(result.status,'complete',JSON.stringify(result.blockers));if(result.status!=='complete')return;
 const doc=new Doc(),host=new Element('af-user',{'data-af-id':'person'}) as any;doc.body.append(host);const port=client({}),running=await execute(result.authorJs,port,doc);
 assert.equal(port.remotes.length,1);assert.equal(host.hidden,true);
 port.remotes[0]!.next({data:{identity:{viewer:{id:'usr_one'}}}});await Promise.resolve();assert.equal(host.hidden,false);assert.deepEqual(port.remotes[1]!.variables,{ids0:['usr_one']});
 port.remotes[1]!.next({data:{peopleData:{people:[{id:'usr_one',name:'Actual profile',handle:null,image:null}]}}});assert.equal(host.person.name,'Actual profile');
 port.remotes[0]!.next({loading:true});assert.equal(host.person,null);assert.equal(host.hidden,true);assert.equal(port.remotes[1]!.stopped,true);
 port.remotes[0]!.next({data:{identity:{viewer:{id:null}}}});assert.equal(host.person,null);assert.equal(host.hidden,false);await running.close();
});

test('read-only binding observers batch updates without extra watches and fence stale query results',async()=>{
 const source=input([],[]);source.analysis.flow.queries=[{name:'rows',start:0,end:1}];
 source.queries=[{name:'rows',namespace:'ops',document:'query($values:String){ops{evaluate(values:$values){tables{name}}}}',values:[{name:'filter',type:'string'}],tableName:'rows',responsePath:['ops','evaluate','tables'],decode:'registered-page-table-cells-v1'}];
 const result=emitNativeBindings(source);assert.equal(result.status,'complete',JSON.stringify(result.blockers));if(result.status!=='complete')return;
 const port=client({open:false,filter:null}),runtime=await execute(result.authorJs,port,new Doc()),seen:any[]=[];
 const stop=runtime.module.dispose.observe((snapshot:any)=>seen.push(snapshot));assert.equal(port.remotes.length,1);assert.equal(seen[0].queries.rows.loading,true);
 const response=(value:number)=>({data:{ops:{evaluate:{tables:[{name:'rows',error:null,columns:[{name:'n',type:'number'}],rows:[{cells:[{isNull:false,number:value}]}]}]}}}});
 port.remotes[0]!.next(response(1));port.remotes[0]!.next(response(2));await Promise.resolve();assert.equal(seen.length,2);assert.deepEqual(seen[1].queries.rows.rows,[{n:2}]);assert.equal(Object.isFrozen(seen[1].queries.rows.rows[0]),true);
 await port.updateQuery({},value=>({...value,filter:'new'}));await Promise.resolve();assert.equal(port.remotes.length,2);assert.equal(seen.at(-1).queries.rows.loading,true);
 port.remotes[0]!.next(response(9));await Promise.resolve();assert.equal(seen.at(-1).queries.rows.rows,null);
 port.remotes[1]!.next({errors:[{message:'revoked'}]});await Promise.resolve();assert.equal(seen.at(-1).queries.rows.error,'Query unavailable');assert.equal(seen.at(-1).queries.rows.loading,false);
 const before=seen.length;stop();port.remotes[1]!.next(response(3));await Promise.resolve();assert.equal(seen.length,before);assert.equal(port.remotes.length,2);
 const disposed:any[]=[];runtime.module.dispose.observe((snapshot:any)=>disposed.push(snapshot));runtime.module.dispose();assert.equal(disposed.at(-1).active,false);port.remotes[1]!.next(response(4));await Promise.resolve();assert.equal(disposed.at(-1).active,false);await runtime.close();
});

test('Select query options preserve retained first-column value and second-column labels without extra reads',async()=>{
 const source=input([el('select','Select',{value:'$filter',options:'$choices'})],[{kind:'property',sourceNode:'select',afId:'select',property:'value',attribute:'value'},{kind:'property',sourceNode:'select',afId:'select',property:'options',attribute:'options'}]);
 source.analysis.flow.queries=[{name:'choices',start:0,end:1}];source.queries=[{name:'choices',namespace:'ops',document:'query {ops{evaluate{tables{name}}}}',values:[],tableName:'choices',responsePath:['ops','evaluate','tables'],decode:'registered-page-table-cells-v1'}];
 const result=emitNativeBindings(source);assert.equal(result.status,'complete',JSON.stringify(result.blockers));if(result.status!=='complete')return;
 const doc=new Doc(),host=new Element('af-select',{'data-af-id':'select'}) as any;doc.body.append(host);const port=client({filter:null,open:false}),runtime=await execute(result.authorJs,port,doc);
 assert.deepEqual(host.options,[]);assert.equal(port.remotes.length,1);
 port.remotes[0]!.next({data:{ops:{evaluate:{tables:[{name:'choices',error:null,columns:[{name:'key',type:'number'},{name:'label',type:'string'}],rows:[{cells:[{isNull:false,number:7},{isNull:false,text:'Seven'}]},{cells:[{isNull:true},{isNull:true}]}]}]}}}});assert.deepEqual(host.options,[{value:'7',label:'Seven'},{value:'',label:''}]);
 port.remotes[0]!.next({errors:[{message:'revoked'}]});assert.deepEqual(host.options,[]);assert.equal(port.state.filter,null);assert.equal(port.remotes.length,1);await runtime.close();
});
