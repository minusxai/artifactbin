import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planAssets,
  extractAssets,
  type AssetSnapshot,
} from "../src/migration/assets/index.ts";
const bytes = Buffer.from([0, 255, 17, 128]);
const digest = createHash("sha256").update(bytes).digest("hex");
const key = `image/${digest.slice(0, 32)}`;
const snapshot = (
  meta: Record<string, unknown>,
  version = 1,
): AssetSnapshot => ({ artifactId: "sample", version, format: "image", meta });
test("inventory preserves archived versions and variants, deduplicates keys and ignores image quota size", () => {
  const plan = planAssets([
    snapshot({
      objectKey: key,
      smallObjectKey: key,
      bytes: 8,
      contentType: "image/webp",
      smallWidth: 320,
      width: 640,
      height: 480,
      sha256: "upload",
    }),
    snapshot({ objectKey: key, bytes: 4, contentType: "image/webp" }, 2),
  ]);
  assert.equal(plan.objects.length, 1);
  assert.equal(plan.objects[0]?.expectedBytes, 4);
  assert.equal(plan.objects[0]?.references.length, 3);
  assert.equal(plan.objects[0]?.references[1]?.width, 320);
  assert.equal(plan.objects[0]?.references[0]?.uploadedSha256, "upload");
  assert.ok(Object.isFrozen(plan.objects[0]?.references));
});
test("inventory rejects unsafe keys and inconsistent shared object metadata", () => {
  for (const objectKey of [
    "../secret",
    "https://example.test/file",
    "image/%2e%2e",
    "/absolute",
  ])
    assert.throws(() => planAssets([snapshot({ objectKey })]));
  assert.throws(() =>
    planAssets([
      snapshot({ objectKey: key, contentType: "image/png" }),
      snapshot({ objectKey: key, contentType: "image/jpeg" }),
    ]),
  );
  assert.throws(() =>
    planAssets([
      snapshot({ objectKey: key, bytes: 4 }),
      snapshot({ objectKey: key, bytes: 5 }),
    ]),
  );
});
test("streamed extraction verifies stored bytes, keeps private permissions and records independent failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-assets-"));
  try {
    const missing = `file/${"a".repeat(32)}`;
    const plan = planAssets([
      snapshot({
        objectKey: key,
        contentType: "image/webp",
        bytes: 4,
        sha256: "different-upload",
      }),
      {
        artifactId: "file",
        version: 1,
        format: "file",
        meta: {
          objectKey: missing,
          bytes: 1,
          filename: "example.txt",
          contentType: "text/plain",
        },
      },
    ]);
    const receipts = await extractAssets(
      plan,
      {
        async read(k) {
          if (k === missing) throw new Error("private provider details");
          return (async function* () {
            yield bytes.subarray(0, 2);
            yield bytes.subarray(2);
          })();
        },
      },
      join(root, "private"),
    );
    const copied = receipts.find((r) => r.status === "copied");
    assert.ok(copied && copied.status === "copied");
    assert.equal(copied.sha256, digest);
    assert.deepEqual(await readFile(copied.path), bytes);
    assert.equal((await stat(copied.path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "private"))).mode & 0o777, 0o700);
    assert.deepEqual(
      receipts.find((r) => r.objectKey === missing),
      { objectKey: missing, status: "failed", reason: "unavailable" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("size and digest failures leave no published bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-assets-"));
  try {
    for (const [expectedBytes, reason] of [
      [5, "size_mismatch"],
      [4, "digest_mismatch"],
    ] as const) {
      const plan = planAssets([
        {
          artifactId: "file",
          version: 1,
          format: "file",
          meta: { objectKey: `file/${"b".repeat(32)}`, bytes: expectedBytes },
        },
      ]);
      const output = join(root, reason);
      const result = await extractAssets(
        plan,
        {
          async read() {
            return (async function* () {
              yield bytes;
            })();
          },
        },
        output,
      );
      assert.equal(result[0]?.status, "failed");
      assert.equal(result[0]?.status === "failed" && result[0].reason, reason);
      assert.deepEqual(await readdir(output), []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("forged plans cannot fetch arbitrary keys or duplicates before any read", async () => {
  let reads = 0;
  const reader = {
    async read() {
      reads++;
      return (async function* () {
        yield bytes;
      })();
    },
  };
  await assert.rejects(
    extractAssets(
      {
        objects: [
          {
            objectKey: "https://example.test/private",
            contentType: "text/plain",
            references: [],
          },
        ],
      },
      reader,
      "unused",
    ),
  );
  const object = { objectKey: key, contentType: "image/webp", references: [] };
  await assert.rejects(
    extractAssets({ objects: [object, object] }, reader, "unused"),
  );
  assert.equal(reads, 0);
});
test("a prior copy is never overwritten and filenames are metadata only", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-assets-"));
  try {
    const plan = planAssets([
      {
        artifactId: "file",
        version: 1,
        format: "file",
        meta: {
          objectKey: `file/${digest.slice(0, 32)}`,
          bytes: 4,
          filename: "../../outside",
        },
      },
    ]);
    assert.equal(plan.objects[0]?.references[0]?.filename, "../../outside");
    const reader = {
      async read() {
        return (async function* () {
          yield bytes;
        })();
      },
    };
    const first = await extractAssets(plan, reader, root);
    const second = await extractAssets(plan, reader, root);
    assert.equal(first[0]?.status, "copied");
    assert.equal(second[0]?.status, "failed");
    assert.deepEqual(await readdir(root), [`file-${digest.slice(0, 32)}`]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
