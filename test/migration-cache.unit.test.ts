import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archivedCompilerIdentity,
  cachedMigrationConverter,
} from "../src/migration/cache.ts";
test("private conversion cache varies full inputs/compiler, retries corrupt and failed records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-cache-"));
  let calls = 0;
  const underlying = () => {
    calls++;
    return {
      classification: "renderable" as const,
      html: "<p>ok</p>",
      issues: [],
      identities: {},
    };
  };
  try {
    const a = cachedMigrationConverter(underlying, {
      directory,
      compilerIdentity: "build-a",
      strategy: "static",
    });
    const input = {
      source: "fixture",
      coreUrl: "/af/v1/core.js",
      meta: { theme: "one" },
    };
    await a.convert(input);
    await a.convert(input);
    assert.equal(calls, 1);
    assert.equal(a.stats.hits, 1);
    const path = join(directory, (await readdir(directory))[0]!);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.result.html = "<p>tampered</p>";
    await writeFile(path, JSON.stringify(record));
    await a.convert(input);
    assert.equal(calls, 2);
    assert.equal(a.stats.invalid, 1);
    await a.convert({ ...input, meta: { theme: "two" } });
    assert.equal(calls, 3);
    await cachedMigrationConverter(underlying, {
      directory,
      compilerIdentity: "build-b",
      strategy: "static",
    }).convert(input);
    assert.equal(calls, 4);
    const binding = {
      name: "rows",
      mode: "live" as const,
      legacyRef: "dataset:fixture",
      backendNamespace: "store",
      backendHref: "/af/v1/ids/abc123",
      version: 1,
      tables: [],
    };
    await a.convert({ ...input, datasetBindings: [binding] });
    await a.convert({ ...input, datasetBindings: [binding] });
    assert.equal(calls, 5);
    await a.convert({
      ...input,
      datasetBindings: [{ ...binding, version: 2 }],
    });
    assert.equal(calls, 6);
    const proof = {
      valueName: "who",
      sourceRef: "ref:abc123",
      version: 1,
      bindingName: "rows",
      schema: "public",
      table: "rows" as const,
      column: "who",
      type: "user" as const,
      constraints: { self: true },
    };
    await a.convert({ ...input, boundValueColumns: [proof] });
    await a.convert({ ...input, boundValueColumns: [proof] });
    assert.equal(calls, 7);
    await a.convert({
      ...input,
      boundValueColumns: [{ ...proof, constraints: { self: false } }],
    });
    assert.equal(calls, 8);
    await a.convert({
      ...input,
      membersBinding: {
        backendNamespace: "legacyData",
        backendHref: "/af/v1/ids/abc123",
      },
    });
    await a.convert({
      ...input,
      membersBinding: {
        backendNamespace: "legacyData",
        backendHref: "/af/v1/ids/abc123",
      },
    });
    assert.equal(calls, 9);
    await a.convert({
      ...input,
      membersBinding: {
        backendNamespace: "legacyData",
        backendHref: "/af/v1/ids/def456",
      },
    });
    assert.equal(calls, 10);
    let attempts = 0;
    const flaky = cachedMigrationConverter(
      () => {
        if (++attempts === 1) throw new Error("retry");
        return underlying();
      },
      { directory, compilerIdentity: "flaky", strategy: "static" },
    );
    await assert.rejects(async () => flaky.convert(input));
    await flaky.convert(input);
    assert.equal(attempts, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compiler provenance covers transitive source, dependency locks and generated font bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "compiler-inputs-"));
  const migrationRoot = join(root, "migration");
  const legacyRoot = join(root, "legacy");
  const files = [
    [migrationRoot, "src/apollo/helper.ts"],
    [migrationRoot, "package.json"],
    [migrationRoot, "package-lock.json"],
    [legacyRoot, "package.json"],
    [legacyRoot, "package-lock.json"],
    [legacyRoot, "services/app/package.json"],
    [legacyRoot, "services/app/lib/data/story/story-font-manifest.json"],
    [legacyRoot, "services/app/public/fonts/fixture.woff2"],
    [legacyRoot, "services/app/public/islands/manifest.json"],
    [legacyRoot, "services/app/scripts/copy-assets.mjs"],
    [legacyRoot, "node_modules/@fontsource-variable/fixture/package.json"],
    [legacyRoot, "node_modules/@fontsource-variable/fixture/metadata.json"],
    [legacyRoot, "node_modules/@fontsource-variable/fixture/index.css"],
    [legacyRoot, "node_modules/@fontsource-variable/fixture/files/latin.woff2"],
    [legacyRoot, "node_modules/wawoff2/package.json"],
    [legacyRoot, "node_modules/wawoff2/build/decompress_binding.js"],
  ] as const;
  try {
    for (const [base, relative] of files) {
      const path = join(base, relative);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        relative.endsWith("package.json") ? "{}" : "original",
      );
    }
    const identity = () =>
      archivedCompilerIdentity(legacyRoot, { migrationRoot });
    const original = await identity();
    assert.equal(await identity(), original);
    for (const [base, relative] of files) {
      const path = join(base, relative);
      await writeFile(
        path,
        relative.endsWith("package.json") ? '{"changed":true}' : "changed",
      );
      assert.notEqual(await identity(), original, relative);
      await writeFile(
        path,
        relative.endsWith("package.json") ? "{}" : "original",
      );
      assert.equal(await identity(), original);
    }
    const withResources = (compilerResourceDigest: string) =>
      archivedCompilerIdentity(legacyRoot, {
        migrationRoot,
        compilerResourceDigest,
      });
    assert.notEqual(
      await withResources("a".repeat(64)),
      await withResources("b".repeat(64)),
    );
    await assert.rejects(withResources("unverified"), /resource digest/);
    await rm(join(legacyRoot, "services/app/public/fonts"), {
      recursive: true,
    });
    await assert.rejects(identity, { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("conversion cache includes current viewer routing without caching viewer identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-viewer-cache-"));
  try {
    let calls = 0;
    const cached = cachedMigrationConverter(
      () => {
        calls++;
        return {
          classification: "renderable",
          html: "<p>fixture</p>",
          issues: [],
          identities: {},
        };
      },
      { directory, compilerIdentity: "fixture", strategy: "functional" },
    );
    const input = {
      source: "<p>{$_me.id}</p>",
      coreUrl: "/af/v1/core.js",
      viewerBinding: {
        backendNamespace: "legacyData",
        backendHref: "/af/v1/ids/Back12",
      },
    };
    await cached.convert(input);
    await cached.convert(input);
    assert.equal(calls, 1);
    await cached.convert({
      ...input,
      viewerBinding: {
        ...input.viewerBinding,
        backendHref: "/af/v1/ids/Back34",
      },
    });
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("conversion cache distinguishes typed editing-cell metadata independently of authored source and ordinary parameters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-cell-cache-"));
  try {
    let calls = 0;
    const cached = cachedMigrationConverter(
      () => {
        calls++;
        return {
          classification: "renderable",
          html: "<p>fixture</p>",
          issues: [],
          identities: {},
        };
      },
      { directory, compilerIdentity: "fixture", strategy: "functional" },
    );
    const mutation = {
      name: "editCell",
      backendNamespace: "legacyData",
      recoveryScope: "a".repeat(64),
      paramTypes: {},
      valueParam: { param: "cell__value", type: "number" as const },
    };
    const input = {
      source: "unchanged",
      coreUrl: "/af/v1/core.js",
      datasetMutations: [mutation],
    };
    await cached.convert(input);
    await cached.convert(input);
    assert.equal(calls, 1);
    await cached.convert({
      ...input,
      datasetMutations: [
        { ...mutation, valueParam: { param: "cell__value", type: "string" } },
      ],
    });
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
