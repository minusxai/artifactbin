import type {
  NativeCatalogProjection,
  NativeCatalogObjectSource,
  NativeImmutableObjectSink,
  NativeStagedCatalog,
} from "./catalog-contracts";
import { verifyNativeCanonicalDatasets } from "./catalog-source";
import { nativeCatalogBytes, nativeCatalogDigest } from "./catalog-digest";
import { assertNativeObjectKey } from "./catalog-staging";
import {
  validateNativeCatalogProjection,
  applyNativeCatalog,
  verifyNativeCatalog,
} from "./catalog-publication";
export async function stageNativeCatalog(
  input: NativeCatalogProjection,
  source: NativeCatalogObjectSource,
  sink: NativeImmutableObjectSink,
): Promise<NativeStagedCatalog> {
  const projection = structuredClone(input),
    { sha256, ...payload } = projection;
  if (sha256 !== nativeCatalogDigest(payload))
    throw Error("native_catalog_projection_digest");
  validateNativeCatalogProjection(projection);
  if (source.objectManifestSha256 !== projection.objectManifestSha256)
    throw Error("native_catalog_source_manifest_digest");
  await verifyNativeCanonicalDatasets(projection, source);
  const keys = new Set<string>();
  for (const object of projection.objects) {
    assertNativeObjectKey(object.objectKey);
    assertNativeObjectKey(object.targetKey);
    if (
      keys.has(object.targetKey) ||
      object.status !== "copied" ||
      !/^[a-f0-9]{64}$/.test(object.sha256) ||
      !Number.isSafeInteger(object.bytes) ||
      object.bytes < 0
    )
      throw Error("native_catalog_object_receipt");
    keys.add(object.targetKey);
  }
  const check = (bytes: Buffer, object: { sha256: string; bytes: number }) => {
    if (
      bytes.length !== object.bytes ||
      nativeCatalogBytes(bytes) !== object.sha256
    )
      throw Error("native_catalog_object_digest");
  };
  // Validate all source bytes before the first publication; a bad final receipt
  // cannot leave a prefix falsely reported as a staged complete projection.
  for (const object of projection.objects) {
    const bytes = await source.read(object);
    check(bytes, object);
    if (object.objectKey.startsWith("dataset/")) {
      const rows: unknown = JSON.parse(bytes.toString("utf8"));
      if (!Array.isArray(rows)) throw Error("native_catalog_row_object");
      const visit = (value: unknown): void => {
        if (
          typeof value === "string" &&
          Object.hasOwn(projection.identities.users, value) &&
          projection.identities.users[value] !== value
        )
          throw Error("native_catalog_cell_identity_translation_required");
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object")
          Object.values(value).forEach(visit);
      };
      visit(rows);
    }
  }
  for (const object of projection.objects) {
    const bytes = await source.read(object);
    check(bytes, object);
    await sink.putIfAbsent(object.targetKey, bytes, object.contentType);
    check(await sink.get(object.targetKey), object);
  }
  const verifyObjects = async () => {
    for (const object of projection.objects)
      check(await sink.get(object.targetKey), object);
  };
  return {
    projectionSha256: sha256,
    sourceSha256: sha256,
    get staged() {
      return structuredClone(projection.objects);
    },
    async verifyObject(key, hash, bytes) {
      const matches = projection.objects.filter(
        (o) => o.targetKey === key && o.sha256 === hash && o.bytes === bytes,
      );
      if (matches.length !== 1) throw Error("native_catalog_object_not_staged");
      check(await sink.get(key), matches[0]!);
    },
    async apply(tx, pageId) {
      await verifyObjects();
      await applyNativeCatalog(tx, projection, pageId);
    },
    async verify(tx, pageId) {
      await verifyObjects();
      await verifyNativeCatalog(tx, projection, pageId);
    },
  };
}
