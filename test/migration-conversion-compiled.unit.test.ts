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
