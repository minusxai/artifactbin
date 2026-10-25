import { runInNewContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareNativeReaderTemplate,
  renderNativeReaderTemplate,
  NATIVE_CONTENTS_AUTHOR_JS,
} from "./reader-template.ts";
import type {
  NativeTypedAnalysis,
  RetainedJsxNode,
} from "./analyze-contracts.ts";
import type { NativeIdentityRevision } from "./identity-contracts.ts";
import { nativeDigest } from "./selection.ts";
function fixture(template: string | null = "editorial") {
  let seq = 0;
  const heading = (tag: string, text: string): RetainedJsxNode => ({
    type: "element",
    tag,
    graphKey: "node" + seq++,
    start: 0,
    end: 1,
    isComponent: false,
    selfClosing: false,
    attributes: [],
    children: [
      { type: "text", graphKey: "text" + seq++, start: 0, end: 1, value: text },
    ],
  });
  const nodes = [
    heading("h1", "Title"),
    heading("h2", "First <one>"),
    heading("h3", "  Child\n title "),
    heading("h2", "Second"),
    heading("h2", "Third"),
  ];
  const key = { sourceNamespace: "synthetic", sourceId: "page", version: 1 };
  const analysis: NativeTypedAnalysis = {
    key,
    documentSha256: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    analysisSha256: "c".repeat(64),
    compilerSourceSha256: "d".repeat(64),
    nodes,
    flow: { values: [], queries: [], mutations: [], imports: [] },
    sourceSpans: [],
  };
  const identity: NativeIdentityRevision = {
    key,
    bindings: nodes.map((node, i) => ({
      sourceNode: node.graphKey,
      afId: "stable" + i,
      analysisSha256: analysis.analysisSha256,
      sourceSha256: analysis.sourceSha256,
      sourceStart: 0,
      sourceEnd: 1,
      proofSha256: "e".repeat(64),
      kind: "element",
      owner: "$root",
    })),
    reservedIdentities: [],
    proofSha256: "f".repeat(64),
  };
  return {
    analysis,
    identity,
    template,
    chrome: true,
    sourceRecordSha256: "1".repeat(64),
  };
}
test("editorial contents reproduces heading eligibility, labels, sibling geometry and stable identity targets", () => {
  const input = fixture(),
    before = nativeDigest(input),
    receipt = prepareNativeReaderTemplate(input);
  assert.deepEqual(
    receipt.entries.map((e) => [e.level, e.title, e.afId]),
    [
      [2, "First <one>", "stable1"],
      [3, "Child title", "stable2"],
      [2, "Second", "stable3"],
      [2, "Third", "stable4"],
    ],
  );
  const output = renderNativeReaderTemplate(
    receipt,
    '<article data-af-id="untouched">Content</article>',
  );
  assert.match(
    output.html,
    /<div class="mx-reading" data-af-reader-template><nav class="mx-outline" aria-label="Contents">/,
  );
  assert.match(output.html, /Go to section 1: First &lt;one&gt;/);
  assert.match(output.html, /data-af-contents-target="stable1"/);
  assert.match(
    output.html,
    /<div class="mx-doc"><article data-af-id="untouched">Content<\/article><\/div><\/div>$/,
  );
  assert.doesNotMatch(output.html, /data-af-id="stable|data-mx-ast|href="#/);
  assert.match(output.css, /@media \(max-width: 1023px\)/);
  assert.match(output.css, /flex: 0 0 208px/);
  assert.match(output.css, /container-type: inline-size/);
  assert.equal(nativeDigest(input), before);
});
test("doc includes title even below threshold; editorial/plan exclude decks, grids and short pages; chrome false suppresses navigation", () => {
  const doc = fixture("doc");
  doc.analysis.nodes = doc.analysis.nodes.slice(0, 1);
  assert.equal(prepareNativeReaderTemplate(doc).rail, true);
  assert.equal(prepareNativeReaderTemplate(doc).entries[0]?.level, 1);
  const empty = fixture("doc");
  empty.analysis.nodes = [];
  assert.match(
    renderNativeReaderTemplate(prepareNativeReaderTemplate(empty), "").html,
    /aria-label="Contents" hidden/,
  );
  for (const tag of ["Grid", "Slide"]) {
    const input = fixture();
    const node = input.analysis.nodes[0]!;
    if (node.type === "element") {
      node.tag = tag;
      node.isComponent = true;
      if (tag === "Slide")
        input.analysis.nodes.push({ ...node, graphKey: "second-slide" });
    }
    assert.equal(prepareNativeReaderTemplate(input).rail, false);
  }
  const short = fixture();
  short.analysis.nodes = short.analysis.nodes.slice(0, 3);
  assert.equal(prepareNativeReaderTemplate(short).rail, false);
  const off = fixture();
  off.chrome = false;
  assert.equal(prepareNativeReaderTemplate(off).rail, false);
  const plain = fixture(null);
  assert.equal(prepareNativeReaderTemplate(plain).rail, false);
  const plan = fixture("plan");
  assert.match(
    renderNativeReaderTemplate(prepareNativeReaderTemplate(plan), "").html,
    /mx-reading mx-reading--plan/,
  );
});
test("does not admit an absent or ambiguous heading identity", () => {
  const input = fixture();
  input.identity.bindings = [];
  assert.throws(() => prepareNativeReaderTemplate(input), /heading identity/);
});

test("emitted plain DOM behavior scrolls only the exact native heading, marks upper-third section, and responds after mutation", () => {
  const make = () => {
    const attributes = new Map<string, string>();
    return {
      attributes,
      getAttribute(name: string) {
        return attributes.get(name) ?? null;
      },
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      removeAttribute(name: string) {
        attributes.delete(name);
      },
    };
  };
  const rows = [make(), make(), make()];
  rows.forEach((row, i) =>
    row.setAttribute("data-af-contents-target", "h" + i),
  );
  rows[2]!.setAttribute("data-af-contents-target", "h0");
  rows[2]!.setAttribute("data-af-contents-dom-id", "markdown-host-heading-1");
  const scrolled: unknown[] = [];
  let tops = [400, 500, 900];
  const headings = rows.map((_, i) => ({
    ...make(),
    id: i === 2 ? "markdown-host-heading-1" : "heading" + i,
    getBoundingClientRect: () => ({ top: tops[i] }),
    scrollIntoView: (options: unknown) => scrolled.push({ i, options }),
  }));
  headings.forEach((node, i) => node.setAttribute("data-af-id", "h" + i));
  const events = new Map<string, () => void>();
  let click: (event: unknown) => void = () => {};
  let mutation = () => {};
  const timers: (() => void)[] = [];
  const root = {
    contains: (row: unknown) => rows.includes(row as (typeof rows)[number]),
    querySelectorAll: (selector: string) =>
      selector.startsWith(".mx-doc") ? headings : rows,
    addEventListener: (_name: string, listener: typeof click) => {
      click = listener;
    },
  };
  const win = {
    innerHeight: 900,
    addEventListener: (name: string, listener: () => void) =>
      events.set(name, listener),
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return 1;
    },
    MutationObserver: class {
      constructor(listener: () => void) {
        mutation = listener;
      }
      observe() {}
    },
  };
  runInNewContext(NATIVE_CONTENTS_AUTHOR_JS, {
    document: { defaultView: win, querySelector: () => root },
  });
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-current")),
    ["true", null, null],
  );
  click({ target: { closest: () => rows[2] } });
  assert.equal(
    JSON.stringify(scrolled),
    JSON.stringify([{ i: 2, options: { behavior: "smooth", block: "start" } }]),
  );
  tops = [-10, 299, 900];
  events.get("scroll")!();
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-current")),
    [null, "true", null],
  );
  tops = [-10, -10, -10];
  events.get("resize")!();
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-current")),
    [null, null, "true"],
  );
  rows[2]!.removeAttribute("aria-current");
  mutation();
  mutation();
  assert.equal(timers.length, 1);
  timers.shift()!();
  assert.equal(rows[2]!.getAttribute("aria-current"), "true");
});

test("source-bound Markdown outline follows existing native heading IDs and preserves host identity", async () => {
  const { prepareNativeMarkdown } = await import("./markdown.ts");
  const input = fixture("doc");
  const node = {
    type: "element",
    tag: "Markdown",
    graphKey: "markdown",
    isComponent: true,
    start: 0,
    end: 1,
    selfClosing: false,
    attributes: [],
    children: [
      {
        type: "expression",
        graphKey: "source",
        start: 0,
        end: 1,
        source: "",
        value: { static: true, json: "# Title\n## Section" },
      },
    ],
  } as RetainedJsxNode;
  input.analysis.nodes = [node];
  input.identity.bindings = [
    { ...input.identity.bindings[0]!, sourceNode: "markdown", afId: "md-host" },
  ];
  const markdown = prepareNativeMarkdown({
    analysis: input.analysis,
    identity: input.identity,
    parserSha256: "a".repeat(64),
    parsed: [
      {
        sourceNode: "markdown",
        source: "# Title\n## Section",
        html: "<h1>Title</h1><h2>Section</h2>",
        headings: [
          { level: 1, title: "Title" },
          { level: 2, title: "Section" },
        ],
        errors: [],
      },
    ],
  });
  const receipt = prepareNativeReaderTemplate({ ...input, markdown });
  assert.deepEqual(
    receipt.entries.map((e) => [e.afId, e.domId]),
    [
      ["md-host", "native-md-md-host-heading-0"],
      ["md-host", "native-md-md-host-heading-1"],
    ],
  );
  assert.match(
    renderNativeReaderTemplate(receipt, "").html,
    /data-af-contents-dom-id="native-md-md-host-heading-1"/,
  );
  assert.throws(() =>
    prepareNativeReaderTemplate({
      ...input,
      markdown: [{ ...markdown[0]!, source: "tampered" }],
    }),
  );
});
