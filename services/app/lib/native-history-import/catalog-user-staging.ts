import type {
  NativeCatalogProjection,
  NativeCatalogObjectSource,
} from "./catalog-contracts";
import type {
  NativeCatalogUserTable,
  NativeCatalogUserDerivation,
} from "./catalog-user-remap-contracts";
import {
  deriveNativeUserObject,
  nativeUserBindingKey,
} from "./catalog-user-remap";
import { nativeCatalogBytes, nativeCatalogDigest } from "./catalog-digest";
/** Complete source-catalog census: a needed remap cannot disappear through an omitted receipt. */
export async function verifyNativeUserDerivations(
  p: NativeCatalogProjection,
  tables: readonly NativeCatalogUserTable[],
  source: NativeCatalogObjectSource,
): Promise<NativeCatalogUserDerivation[]> {
  const supplied = new Map<
    string,
    NonNullable<NativeCatalogProjection["typedUserRemaps"]>[number]
  >();
  for (const receipt of p.typedUserRemaps ?? []) {
    const key = nativeUserBindingKey(receipt);
    if (supplied.has(key)) throw Error("native_catalog_duplicate_user_remap");
    supplied.set(key, receipt);
  }
  const derived: NativeCatalogUserDerivation[] = [];
  for (const table of tables) {
    const objects = p.objects.filter(
      (o) =>
        o.objectKey === table.sourceObjectKey && o.targetKey === o.objectKey,
    );
    if (objects.length !== 1)
      throw Error("native_catalog_user_original_object_missing");
    const object = objects[0]!,
      bytes = await source.read(object);
    if (
      bytes.length !== object.bytes ||
      nativeCatalogBytes(bytes) !== object.sha256
    )
      throw Error("native_catalog_user_source_digest");
    const expected = deriveNativeUserObject(
        table,
        bytes,
        p.identities.users,
        p.identityPlanSha256 ?? "",
      ),
      key = nativeUserBindingKey(table),
      receipt = supplied.get(key);
    if (expected) {
      if (
        !receipt ||
        nativeCatalogDigest(receipt) !== nativeCatalogDigest(expected.receipt)
      )
        throw Error("native_catalog_user_derivation_proof");
      derived.push(expected);
      supplied.delete(key);
    } else if (receipt) throw Error("native_catalog_unneeded_user_remap");
  }
  if (supplied.size) throw Error("native_catalog_unknown_user_remap");
  return derived;
}
