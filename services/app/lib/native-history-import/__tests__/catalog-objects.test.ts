import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stageNativeCatalog } from "../catalog-objects";
import { createNativeLocalObjectSink } from "../catalog-staging";
import { nativeCatalogBytes, nativeCatalogDigest } from "../catalog-digest";
import type { NativeCatalogProjection } from "../catalog-contracts";
function fixture() {
  const bytes = Buffer.from('[{"amount":2},{"amount":4}]'),
    sha256 = nativeCatalogBytes(bytes),
    key = "dataset/" + sha256.slice(0, 32);
  const payload = {
    imports: [],
    identities: { users: {}, tokens: {}, groups: {}, artifacts: {} },
    sourceNamespace: "synthetic",
    selectionSha256: "a".repeat(64),
    sourceManifestSha256: "b".repeat(64),
    objectManifestSha256: "c".repeat(64),
    datasets: [],
    objects: [
      {
        objectKey: key,
        targetKey: key,
        status: "copied" as const,
        sha256,
        bytes: bytes.length,
      },
    ],
  };
  return {
    bytes,
    projection: {
      ...payload,
      sha256: nativeCatalogDigest(payload),
    } as NativeCatalogProjection,
  };
}
it("stages exact immutable keys independently; deterministic replay never overwrites changed bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "native-catalog-"));
  try {
    const { bytes, projection } = fixture(),
      sink = await createNativeLocalObjectSink(root),
      source = {
        objectManifestSha256: projection.objectManifestSha256,
        read: async () => bytes,
      },
      staged = await stageNativeCatalog(projection, source, sink);
    expect(staged.projectionSha256).toBe(projection.sha256);
    expect(await sink.get(projection.objects[0]!.targetKey)).toEqual(bytes);
    await expect(
      stageNativeCatalog(projection, source, sink),
    ).resolves.toBeDefined();
    await writeFile(
      path.join(root, projection.objects[0]!.targetKey),
      "changed",
    );
    await expect(stageNativeCatalog(projection, source, sink)).rejects.toThrow(
      /object/,
    );
    expect((await sink.get(projection.objects[0]!.targetKey)).toString()).toBe(
      "changed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects stale raw digest/size, source ledger or unsafe target paths before staging", async () => {
  const { bytes, projection } = fixture();
  for (const change of [
    (p: NativeCatalogProjection) => {
      p.sha256 = "d".repeat(64);
    },
    (p: NativeCatalogProjection) => {
      p.objects[0]!.bytes++;
    },
    (p: NativeCatalogProjection) => {
      p.objects[0]!.targetKey = "../escape";
    },
  ]) {
    const p = structuredClone(projection);
    change(p);
    let writes = 0;
    await expect(
      stageNativeCatalog(
        p,
        {
          objectManifestSha256: p.objectManifestSha256,
          read: async () => bytes,
        },
        {
          get: async () => bytes,
          putIfAbsent: async () => {
            writes++;
            return "created";
          },
        },
      ),
    ).rejects.toThrow();
    expect(writes).toBe(0);
  }
});
it("atomic local staging admits one winner and compares existing bytes on concurrent writes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "native-catalog-"));
  try {
    const sink = await createNativeLocalObjectSink(root),
      bytes = Buffer.from("image"),
      key = "comment-images/Example/original.webp";
    const attempts = await Promise.all([
      sink.putIfAbsent(key, bytes),
      sink.putIfAbsent(key, bytes),
    ]);
    expect(attempts.sort()).toEqual(["created", "exists"]);
    expect(await readFile(path.join(root, key))).toEqual(bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("binds raw source ledger bytes and verifies explicit attachment aliases without inventing a reader key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "native-catalog-"));
  try {
    const bytes = Buffer.from("raw-image"),
      hash = nativeCatalogBytes(bytes),
      sourceKey = "archived-images/Example.webp",
      targetKey = "comment-images/Mapped/original.webp";
    await writeFile(path.join(root, "image.webp"), bytes);
    const ledger = JSON.stringify([
      {
        objectKey: sourceKey,
        status: "copied",
        sha256: hash,
        bytes: bytes.length,
        path: "image.webp",
      },
    ]);
    await writeFile(path.join(root, "ledger.json"), ledger);
    const { canonicalNativeObjectSource } = await import("../catalog-source"),
      loaded = await canonicalNativeObjectSource(root, "ledger.json"),
      { projection } = fixture();
    projection.datasets = [];
    projection.objects = [{ ...loaded.objects[0]!, targetKey }];
    projection.objectManifestSha256 = loaded.objectManifestSha256;
    const { sha256, ...payload } = projection;
    projection.sha256 = nativeCatalogDigest(payload);
    const sink = await createNativeLocalObjectSink(path.join(root, "staged")),
      staged = await stageNativeCatalog(projection, loaded.source, sink);
    await expect(
      staged.verifyObject(targetKey, hash, bytes.length),
    ).resolves.toBeUndefined();
    await expect(
      staged.verifyObject(sourceKey, hash, bytes.length),
    ).rejects.toThrow(/not_staged/);
    const stale = { ...loaded.source, objectManifestSha256: "0".repeat(64) };
    await expect(stageNativeCatalog(projection, stale, sink)).rejects.toThrow(
      /manifest/,
    );
    await writeFile(path.join(root, "image.webp"), "tampered");
    await expect(
      stageNativeCatalog(projection, loaded.source, sink),
    ).rejects.toThrow(/digest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("canonical proof rejects non-JSON values rather than aliasing null or an empty object", () => {
  for (const value of [
    NaN,
    Infinity,
    undefined,
    new Date(),
    { missing: undefined },
    [undefined],
  ])
    expect(() => nativeCatalogDigest(value)).toThrow(/non_json/);
  expect(nativeCatalogDigest({ b: 2, a: 1 })).toBe(
    nativeCatalogDigest({ a: 1, b: 2 }),
  );
});
