import { verifyNativeUserDerivations } from "./catalog-user-staging";
import {AUTH_SECRET} from '@/lib/platform/config';
import {stageNativeExternalCredentials} from './external-credentials';
import type {NativeExternalCredentialSource} from './external-credential-contracts';
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
  externalCredentials?: NativeExternalCredentialSource,
): Promise<NativeStagedCatalog> {
  const projection = structuredClone(input),
    { sha256, ...payload } = projection;
  if (sha256 !== nativeCatalogDigest(payload))
    throw Error("native_catalog_projection_digest");
  validateNativeCatalogProjection(projection);
  if (source.objectManifestSha256 !== projection.objectManifestSha256)
    throw Error("native_catalog_source_manifest_digest");
  const userTables = await verifyNativeCanonicalDatasets(projection, source);
  const credentials=await stageNativeExternalCredentials(projection,externalCredentials,AUTH_SECRET);
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
    }
  }
  const derivatives = await verifyNativeUserDerivations(
    projection,
    userTables,
    source,
  );
  const complete = new Map(
    projection.objects.map((o) => [
      o.targetKey,
      { sha256: o.sha256, bytes: o.bytes },
    ]),
  );
  for (const { receipt: r } of derivatives) {
    const prior = complete.get(r.targetKey);
    if (
      prior &&
      (prior.sha256 !== r.targetSha256 || prior.bytes !== r.targetBytes)
    )
      throw Error("native_catalog_user_target_collision");
    complete.set(r.targetKey, { sha256: r.targetSha256, bytes: r.targetBytes });
  }
  // Keys whose stored bytes this process has read back and matched. Conditional
  // puts make them immutable, so later verification inside the page transaction
  // does not download them again across the network.
  const readBack = new Set<string>();
  for (const object of projection.objects) {
    const bytes = await source.read(object);
    check(bytes, object);
    await sink.putIfAbsent(object.targetKey, bytes, object.contentType);
    check(await sink.get(object.targetKey), object);
    readBack.add(object.targetKey);
  }
  for (const { receipt: r, bytes } of derivatives) {
    await sink.putIfAbsent(r.targetKey, bytes, "application/json");
    check(await sink.get(r.targetKey), {
      sha256: r.targetSha256,
      bytes: r.targetBytes,
    });
    readBack.add(r.targetKey);
  }
  const verifyObjects = async () => {
    for (const [key, object] of complete)
      if (!readBack.has(key)) {
        check(await sink.get(key), object);
        readBack.add(key);
      }
  };
  return {
    projectionSha256: sha256,
    sourceSha256: sha256,
    get derivedUserObjects() {
      return structuredClone(derivatives.map((d) => d.receipt));
    },
    get staged() {
      return structuredClone(projection.objects);
    },
    async verifyObject(key, hash, bytes) {
      const match = complete.get(key);
      if (!match || match.sha256 !== hash || match.bytes !== bytes)
        throw Error("native_catalog_object_not_staged");
      check(await sink.get(key), match);
    },
    async apply(tx, pageId) {
      await verifyObjects();
      await credentials.apply(tx);
      await applyNativeCatalog(tx, projection, pageId);
    },
    async verify(tx, pageId) {
      await verifyObjects();
      await credentials.verify(tx);
      await verifyNativeCatalog(tx, projection, pageId);
    },
  };
}
