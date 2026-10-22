import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationResourceMap } from "../src/migration/media-render.ts";
import {
  parseLegacyRawMediaAddress,
  rewriteLegacyRawMediaSource,
} from "../src/migration/raw-media.ts";
import type { MigratedAsset } from "../src/migration/media-contracts.ts";
const asset: MigratedAsset = {
  artifactId: "abc123",
  version: 2,
  variant: "original",
  sha256: "a".repeat(64),
  contentType: "application/pdf",
  filename: "fixture.pdf",
  bytes: 8,
  path: "/private/fixture",
};
const target =
  "https://platform.invalid/af/v1/ids/def456/assets/2/original/" + asset.sha256;

test("raw media grammar accepts only bounded exact version and width selectors", () => {
  assert.deepEqual(
    parseLegacyRawMediaAddress("https://legacy.invalid/a/abc123/raw?w=320&v=2"),
    { artifactId: "abc123", version: 2, width: 320 },
  );
  assert.deepEqual(parseLegacyRawMediaAddress("/a/abc123/raw"), {
    artifactId: "abc123",
  });
  for (const value of [
    "/a/abc123/raw?v=0",
    "/a/abc123/raw?v=2&v=3",
    "/a/abc123/raw?w=-1",
    "/a/abc123/raw?token=x",
    "/a/abc123/raw#",
    "//legacy.invalid/a/abc123/raw",
    "/a/abc123/raw/extra",
    "/a/abc123/raw?v=9007199254740992",
  ])
    assert.equal(parseLegacyRawMediaAddress(value), null, value);
});
test("unversioned aliases require explicit immutable head and verified exact variant", () => {
  const assets = [
    asset,
    { ...asset, version: 3, sha256: "b".repeat(64) },
    { ...asset, variant: "small" as const, width: 320, sha256: "c".repeat(64) },
  ];
  const without = migrationResourceMap(
    assets,
    { abc123: "def456" },
    "https://platform.invalid",
    ["https://legacy.invalid"],
  );
  assert.equal(without["/a/abc123/raw"], undefined);
  const map = migrationResourceMap(
    assets,
    { abc123: "def456" },
    "https://platform.invalid",
    ["https://legacy.invalid"],
    { abc123: 2 },
  );
  assert.equal(map["/a/abc123/raw"], target);
  assert.equal(map["https://legacy.invalid/a/abc123/raw"], target);
  assert.match(map["/a/abc123/raw?w=320"]!, /assets\/2\/small\//);
  assert.equal(
    migrationResourceMap(
      assets,
      { abc123: "def456" },
      "https://platform.invalid",
      [],
      { abc123: 4 },
    )["/a/abc123/raw"],
    undefined,
  );
});
test("source literal links and images resolve only registered targets before SSR and hydration", () => {
  const map = migrationResourceMap(
    [asset],
    { abc123: "def456" },
    "https://platform.invalid",
    ["https://legacy.invalid"],
    { abc123: 2 },
  );
  const source =
    '<a id="download" href="https://legacy.invalid/a/abc123/raw?v=2" download>PDF</a><img src={"/a/abc123/raw"}/><File src="/a/abc123/raw"/><a href="/a/unknown/raw?v=2">Missing</a><a href="https://other.invalid/a/abc123/raw?v=2">Other origin</a><a href={$download}>Dynamic</a><File src={$download}/><File src="/a/unknown/raw"/><p>{"/a/abc123/raw"}</p>';
  const result = rewriteLegacyRawMediaSource(source, map);
  assert.equal(result.rewritten, 3);
  assert.equal(result.source.split(target).length, 4);
  assert.match(result.source, /id="download"/);
  assert.match(result.source, /\/a\/unknown\/raw/);
  assert.match(result.source, /other\.invalid/);
  assert.match(result.source, /href=\{\$download\}/);
  assert.match(result.source, /<File src=\{\$download\}/);
  assert.match(result.source, /<File src="\/a\/unknown\/raw"/);
  assert.match(result.source, /<p>\{"\/a\/abc123\/raw"\}<\/p>/);
  assert.equal(rewriteLegacyRawMediaSource(result.source, map).rewritten, 0);
  assert.throws(() =>
    rewriteLegacyRawMediaSource('<a href="/a/abc123/raw">PDF</a>', {
      "/a/abc123/raw": "https://platform.invalid/public/file",
    }),
  );
});

test("normal conversion shares mapped source with compiler and maps static download output without changing archive", async () => {
  const { createMigrationConverter } = await import(
    "../src/migration/convert.ts"
  );
  const source = '<a id="download" href="/a/abc123/raw?v=2" download>PDF</a>';
  let observed = "";
  const convert = createMigrationConverter({
    strategy: "archived-static",
    compiler: {
      async compile(input) {
        observed = input.source;
        return {
          html: source,
          css: "",
          title: "Fixture",
          build: "fixture",
          rootAttributes: {},
          capabilities: [],
        };
      },
    },
  });
  const input = {
    source,
    coreUrl: "/af/v1/core.js",
    resourceMap: { "/a/abc123/raw?v=2": target },
  };
  const result = await convert(input);
  assert.equal(result.classification, "renderable");
  assert.ok(observed.includes(target));
  assert.ok(result.html?.includes(target));
  assert.equal(input.source, source);
  assert.match(result.html!, /download/);
  const refused = await convert({
    ...input,
    resourceMap: {
      "/a/abc123/raw?v=2": "https://platform.invalid/public/file",
    },
  });
  assert.equal(refused.classification, "manual-blocked");
  assert.equal(refused.html, null);
});

test("planner scopes new aliases per exact saved source while preserving unaffected converter inputs", async () => {
  const { planMigration } = await import("../src/migration/import.ts");
  const baseline = { "/a/abc123/raw?v=2": target };
  const inputs: any[] = [];
  const source = '<a href="/a/abc123/raw">PDF</a>';
  const manifest = {
    schemaVersion: 1 as const,
    sourceNamespace: "fixture",
    exportedAt: "2026-01-01T00:00:00Z",
    tokenOwners: [],
    tables: {
      artifact_versions: [
        { artifact_id: "fixture-page", version: 1, format: "markup", source },
      ],
    },
    artifacts: [
      {
        id: "fixture-page",
        format: "markup",
        version: 2,
        user_id: "viewer",
        source: "<p>Unchanged</p>",
        visibility: "private",
      },
    ],
  };
  await planMigration(manifest, {
    maps: {
      pages: {},
      users: { viewer: "new-viewer" },
      groups: {},
      tokens: {},
    },
    coreUrl: "/af/v1/core.js",
    media: {
      origin: "https://platform.invalid",
      assets: [],
      resourceMap: baseline,
      resourceMapAliases: { "/a/abc123/raw": target },
    },
    convert: (input) => {
      inputs.push(input);
      return {
        classification: "renderable",
        html: "<p>Fixture</p>",
        issues: [],
        identities: {},
      };
    },
  });
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0].resourceMap, {
    ...baseline,
    "/a/abc123/raw": target,
  });
  assert.equal(inputs[1].resourceMap, baseline);
  assert.equal(inputs[0].source, source);
});

test("functional compilation receives the same rewritten literal used by its hydration bundle", async () => {
  const { createMigrationConverter } = await import(
    "../src/migration/convert.ts"
  );
  let observed = "";
  const convert = createMigrationConverter({
    strategy: "archived-functional",
    localCompiler: {
      async compile(input) {
        observed = input.source;
        return {
          html: '<a id="download">PDF</a><p id="count">0</p>',
          css: "",
          title: "Fixture",
          build: "fixture",
          rootAttributes: {},
          capabilities: [],
          javascript: 'console.log("fixture")',
          declarations: [
            { name: "count", type: "number" as const, default: 0 },
          ],
          modules: ["rt.js", "kit-basic.js", "solid.js"],
        };
      },
    },
  });
  const result = await convert({
    source:
      '<Value name="count" type="number" default={0}/><a id="download" href="/a/abc123/raw?v=2">PDF</a><p id="count">{$count}</p>',
    coreUrl: "/af/v1/core.js",
    resourceMap: { "/a/abc123/raw?v=2": target },
  });
  assert.equal(result.classification, "functional");
  assert.ok(observed.includes(target));
  assert.ok(!observed.includes("/a/abc123/raw"));
});
