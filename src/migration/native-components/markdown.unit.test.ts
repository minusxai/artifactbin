import test from "node:test";
import assert from "node:assert/strict";
import { prepareNativeMarkdown, verifyNativeMarkdown } from "./markdown.ts";
import { nativeDigest } from "./selection.ts";
const hash = "a".repeat(64);
function fixture() {
  const node = {
    type: "element",
    tag: "Markdown",
    graphKey: "md",
    isComponent: true,
    start: 0,
    end: 1,
    selfClosing: false,
    attributes: [],
    children: [
      {
        type: "expression",
        graphKey: "s",
        start: 0,
        end: 1,
        value: { static: true, json: "# Title\n\n## First" },
      },
    ],
  };
  return {
    analysis: {
      key: { sourceNamespace: "test", sourceId: "page", version: 1 },
      analysisSha256: hash,
      sourceSha256: hash,
      nodes: [node],
    },
    identity: { bindings: [{ sourceNode: "md", afId: "stable-md" }] },
    parserSha256: hash,
    parsed: [
      {
        sourceNode: "md",
        source: "# Title\n\n## First",
        html: '<h1 data-mx-markdown-heading="0">Title</h1><h2 data-mx-markdown-heading="1">First</h2>',
        headings: [
          { level: 1, title: "Title" },
          { level: 2, title: "First" },
        ],
        errors: [],
      },
    ],
  } as unknown as Parameters<typeof prepareNativeMarkdown>[0];
}
test("exact static Markdown source and heading order bind the existing native host", () => {
  const input = fixture(),
    before = nativeDigest(input),
    [receipt] = prepareNativeMarkdown(input);
  assert.equal(receipt!.hostAfId, "stable-md");
  assert.equal(receipt!.hostDomId, "native-md-stable-md");
  assert.deepEqual(receipt!.headings, input.parsed[0]!.headings);
  assert.equal(nativeDigest(input), before);
  assert.equal(verifyNativeMarkdown(input, receipt!), true);
  assert.equal(
    verifyNativeMarkdown(input, { ...receipt!, source: "different" }),
    false,
  );
});
test("missing, duplicate, changed source and parser errors reject instead of omitting Markdown", () => {
  for (const mutate of [
    (x: any) => (x.parsed = []),
    (x: any) => x.parsed.push(x.parsed[0]),
    (x: any) => (x.parsed[0].source += " changed"),
    (x: any) => (x.parsed[0].errors = ["unsupported"]),
    (x: any) => (x.analysis.nodes[0].children[0].value.static = false),
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => prepareNativeMarkdown(input));
  }
});
