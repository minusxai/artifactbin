import test from "node:test";
import { parse } from "parse5";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { planMigration } from "../src/migration/import.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
import {
  readMigrationMedia,
  stageMigrationMedia,
  convertMigrationMedia,
  migrationResourceMap,
} from "../src/migration/media.ts";
test("media receipts require actual full digest bytes and stage only immutable content addresses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-media-"));
  try {
    const path = join(directory, "source");
    const bytes = Buffer.from("fixture bytes");
    await writeFile(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const plan = join(directory, "plan.json"),
      receipts = join(directory, "receipts.json");
    await writeFile(
      plan,
      JSON.stringify({
        objects: [
          {
            objectKey: "object",
            contentType: "image/png",
            expectedBytes: bytes.length,
            references: [
              { artifactId: "abc123", version: 2, variant: "original" },
            ],
          },
        ],
      }),
    );
    await writeFile(
      receipts,
      JSON.stringify([
        {
          objectKey: "object",
          status: "copied",
          path,
          bytes: bytes.length,
          sha256,
        },
      ]),
    );
    const result = await readMigrationMedia(plan, receipts);
    assert.equal(result.verifiedObjects, 1);
    assert.equal(result.assets[0]!.sha256, sha256);
    const urls = migrationResourceMap(
      result.assets,
      { abc123: "def456" },
      "https://example.test",
      ["https://legacy.example.test"],
    );
    assert.equal(
      urls["/a/abc123/raw?v=2"],
      "https://example.test/af/v1/ids/def456/assets/2/original/" + sha256,
    );
    assert.equal(
      urls["https://legacy.example.test/a/abc123/raw?v=2"],
      urls["/a/abc123/raw?v=2"],
    );
    assert.equal(urls["/a/abc123"], undefined);
    const target = join(directory, "staged");
    await stageMigrationMedia(result.assets, target);
    await stageMigrationMedia(result.assets, target);
    assert.deepEqual(await readFile(join(target, sha256)), bytes);
    const output = convertMigrationMedia({
      format: "image",
      version: 2,
      pageId: "abc123",
      title: "Fixture",
      coreUrl: "/af/v1/core.js",
      origin: "https://example.test",
      assets: result.assets,
    });
    assert.equal(output.classification, "renderable");
    const document = parse(output.html!);
    const html = document.childNodes.find(
      (n) => "tagName" in n && n.tagName === "html",
    )!;
    assert.ok("childNodes" in html);
    const head = html.childNodes.find(
      (n) => "tagName" in n && n.tagName === "head",
    )!;
    assert.ok("childNodes" in head);
    const first = head.childNodes.find((n) => "tagName" in n)!;
    assert.ok("tagName" in first);
    assert.equal(first.tagName, "script");
    assert.ok("attrs" in first);
    assert.equal(first.attrs.find((a) => a.name === "data-af")?.value, "core");
    assert.ok(
      output.html?.includes("/af/v1/ids/abc123/assets/2/original/" + sha256),
    );
    assert.ok(!output.html?.includes(path));
    assert.equal(
      convertMigrationMedia({
        format: "image",
        version: 1,
        pageId: "abc123",
        coreUrl: "/af/v1/core.js",
        origin: "https://example.test",
        assets: result.assets,
      }).classification,
      "manual-blocked",
    );
    const manifest: MigrationManifest = {
      schemaVersion: 1,
      sourceNamespace: "fixture",
      exportedAt: "",
      tokenOwners: [],
      tables: {
        artifact_versions: [
          { artifact_id: "abc123", version: 1, format: "image" },
        ],
      },
      artifacts: [
        {
          id: "abc123",
          format: "image",
          version: 2,
          user_id: "user",
          group_id: null,
          token_id: "",
          source: null,
          document: null,
          visibility: "private",
          link_role: "viewer",
        },
      ],
    };
    const options = {
      maps: {
        users: { user: "owner@example.test" },
        tokens: {},
        groups: {},
        pages: {},
      },
      coreUrl: "/af/v1/core.js",
      convert: () => {
        throw new Error("No JSX converter for native media");
      },
      media: { origin: "https://example.test", assets: result.assets },
    };
    const missing = await planMigration(manifest, options);
    assert.equal(missing.pages[0]!.disposition, "blocked");
    const complete = await planMigration(manifest, {
      ...options,
      media: {
        ...options.media,
        assets: [...result.assets, { ...result.assets[0]!, version: 1 }],
      },
    });
    assert.equal(complete.pages[0]!.disposition, "ready");
    assert.equal(complete.pages[0]!.assets!.length, 2);
    assert.ok(!JSON.stringify(complete.pages[0]!.assets).includes(path));
    await writeFile(path, "tampered");
    await assert.rejects(readMigrationMedia(plan, receipts), /digest|length/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
