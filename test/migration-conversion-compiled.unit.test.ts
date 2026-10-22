import { test } from "node:test";
import assert from "node:assert/strict";
import { compileArchivedStatic } from "../src/migration/conversion/compiled/index.ts";
import type { ArchivedCompilerPort } from "../src/migration/conversion/compiled/contracts.ts";
const compiler: ArchivedCompilerPort = {
  async compile() {
    return {
      html: '<div data-mx-inline-story="" data-mx-story=""><div id="Ab12" data-mx-ast="0" data-slot="card">Hello</div></div>',
      css: '[data-slot="card"] { padding: 24px }',
      title: "Example",
      build: "test-build",
      rootAttributes: { class: "light", "data-theme": "dossier" },
      capabilities: ["static-kit"],
    };
  },
};
test("compiled path emits ordinary HTML with core first, exact CSS and stable identity", async () => {
  const result = await compileArchivedStatic(
    { source: '<Card id="Ab12">Hello</Card>', coreUrl: "/af/v1/core.js" },
    { compiler },
  );
  assert.equal(result.classification, "renderable");
  assert.equal(result.provenance?.mode, "static-only");
  assert.match(
    result.html!,
    /<head><script src="\/af\/v1\/core.js" data-af="core"><\/script>/,
  );
  assert.match(result.html!, /data-slot="card"/);
  assert.match(result.html!, /data-af-id="Ab12"/);
  assert.match(result.html!, /padding: 24px/);
  assert.doesNotMatch(
    result.html!,
    /data-mx-ast|__mx|@mx|afbin-code|from ['"]page['"]|<Card/,
  );
});
test("refuses unsupported scripts/data before calling external compiler", async () => {
  let calls = 0;
  const port = {
    async compile() {
      calls++;
      return compiler.compile({} as never);
    },
  };
  for (const source of [
    '<Helmet><script>throw Error("must not execute")</script></Helmet>',
    '<Helmet><Query name="rows">{`select 1`}</Query></Helmet>',
    '<Button run="save">Save</Button>',
  ]) {
    const result = await compileArchivedStatic(
      { source, coreUrl: "/af/v1/core.js" },
      { compiler: port },
    );
    assert.equal(result.classification, "manual-blocked");
  }
  assert.equal(calls, 0);
});
test("refuses compiler HTML carrying runtime code or old transports", async () => {
  for (const html of [
    '<script src="/islands/boot.js"></script>',
    '<div data-mx-live-id="private">x</div>',
    '<a onclick="x()">x</a>',
  ]) {
    const port = {
      async compile() {
        return { ...(await compiler.compile({} as never)), html };
      },
    };
    const result = await compileArchivedStatic(
      { source: "<Card>Hello</Card>", coreUrl: "/af/v1/core.js" },
      { compiler: port },
    );
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
  }
});
test("compiled path refuses unresolved resources and unsafe core configuration", async () => {
  for (const html of [
    '<img src="/api/private-image"/>',
    '<svg><image href="https://example.com/image.svg"/></svg>',
  ]) {
    const port = {
      async compile() {
        return { ...(await compiler.compile({} as never)), html };
      },
    };
    assert.equal(
      (
        await compileArchivedStatic(
          { source: "<Card>Hello</Card>", coreUrl: "/af/v1/core.js" },
          { compiler: port },
        )
      ).classification,
      "manual-blocked",
    );
  }
  assert.equal(
    (
      await compileArchivedStatic(
        { source: "<Card>Hello</Card>", coreUrl: "javascript:alert(1)" },
        { compiler },
      )
    ).classification,
    "manual-blocked",
  );
});

test("only explicit verified media mappings replace archived image dependencies", async () => {
  const target = "/af/v1/ids/Ab1234/assets/1/original/" + "a".repeat(64);
  const imageCompiler = {
    compile: async () => ({
      ...(await compiler.compile({} as never)),
      html: '<img id="image" src="/legacy/example.png">',
    }),
  };
  const input = {
    source: '<img id="image" src="/legacy/example.png"/>',
    coreUrl: "/af/v1/core.js",
  };
  assert.equal(
    (await compileArchivedStatic(input, { compiler: imageCompiler }))
      .classification,
    "manual-blocked",
  );
  const mapped = await compileArchivedStatic(
    { ...input, resourceMap: { "/legacy/example.png": target } },
    { compiler: imageCompiler },
  );
  assert.equal(mapped.classification, "renderable");
  assert.ok(mapped.html!.includes(target));
  assert.ok(!mapped.html!.includes("/legacy/example.png"));
  for (const url of [
    "https://example.invalid/arbitrary.png",
    "/af/v1/ids/Ab1234/assets/0/original/" + "a".repeat(64),
    target + "?token=secret",
  ]) {
    const result = await compileArchivedStatic(
      { ...input, resourceMap: { "/legacy/example.png": url } },
      { compiler: imageCompiler },
    );
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
  }
});

test("static compiled output obeys the unchanged product page source limit", async () => {
  const result = await compileArchivedStatic(
    { source: "<p>Example</p>", coreUrl: "/af/v1/core.js" },
    {
      compiler: {
        compile: async () => ({
          ...(await compiler.compile({} as never)),
          css: "é".repeat(2_000_000),
        }),
      },
    },
  );
  assert.equal(result.classification, "manual-blocked");
  assert.equal(result.issues[0]?.code, "compiled-page-limit");
});

test("verified srcset mapping preserves every candidate descriptor and refuses partial resolution", async () => {
  const first = "/af/v1/ids/Ab1234/assets/1/small/" + "a".repeat(64),
    second = "/af/v1/ids/Ab1234/assets/1/original/" + "b".repeat(64);
  const imageCompiler = {
    compile: async () => ({
      ...(await compiler.compile({} as never)),
      html: '<img src="/old-small.png" srcset="/old-small.png 480w, /old-large.png 960w">',
    }),
  };
  const input = {
    source:
      '<img src="/old-small.png" srcSet="/old-small.png 480w, /old-large.png 960w"/>',
    coreUrl: "/af/v1/core.js",
  };
  const map = { "/old-small.png": first, "/old-large.png": second };
  const result = await compileArchivedStatic(
    { ...input, resourceMap: map },
    { compiler: imageCompiler },
  );
  assert.equal(result.classification, "renderable");
  assert.ok(result.html!.includes(first + " 480w, " + second + " 960w"));
  const missing = await compileArchivedStatic(
    { ...input, resourceMap: { "/old-small.png": first } },
    { compiler: imageCompiler },
  );
  assert.equal(missing.classification, "manual-blocked");
  const invalid = {
    compile: async () => ({
      ...(await imageCompiler.compile()),
      html: '<img src="/old-small.png" srcset="/old-small.png 1x, /old-large.png 1x">',
    }),
  };
  assert.equal(
    (
      await compileArchivedStatic(
        { ...input, resourceMap: map },
        { compiler: invalid },
      )
    ).classification,
    "manual-blocked",
  );
});
