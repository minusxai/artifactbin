import { createHash } from "node:crypto";
import { nativeDigest } from "./selection.ts";
import { extendReviewedNativeLineage } from "./lineage-extension.ts";
import { decodeNativePublicationBytes } from "./pipeline-publication.ts";
import type {
  NativeLineageRemapInput,
  NativeLineageRemapHost,
  NativeLineageRemapResult,
} from "./lineage-remap-contracts.ts";
function fail(code: string): never {
  throw Error("native_lineage_remap_" + code);
}
const bytesSha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
/** Re-attest only existing derived objects. No bytes are written, copied, or recaptured. */
export async function reattestNativeLineageRemaps(
  raw: NativeLineageRemapInput,
  host: NativeLineageRemapHost,
): Promise<NativeLineageRemapResult> {
  const input = structuredClone(raw),
    { parentPlan, extension } = input;
  const expected = extendReviewedNativeLineage({
    plan: parentPlan,
    approvedPlanSha256: parentPlan.sha256,
    source: extension.ancillaryFolders.source,
    approvals: extension.ancillaryFolders.approvals,
    ...(extension.ancillaryFolders.identityGroups
      ? { identityGroups: extension.ancillaryFolders.identityGroups }
      : {}),
  });
  if (nativeDigest(expected) !== nativeDigest(extension))
    fail("extension_changed");
  const users = (plan: typeof parentPlan) =>
    Object.fromEntries(
      Object.entries(plan.targets.users).map(([id, target]) => [
        id,
        target.userId,
      ]),
    );
  const previousUsers = users(parentPlan),
    nextUsers = users(extension.plan),
    usersSha256 = nativeDigest(nextUsers);
  if (
    nativeDigest(previousUsers) !== usersSha256 ||
    nativeDigest(parentPlan.userCellMappings) !==
      nativeDigest(extension.plan.userCellMappings) ||
    input.receipts.length > 4096
  )
    fail("user_mapping_changed");
  const census = JSON.parse(
      Buffer.from(
        decodeNativePublicationBytes(
          extension.ancillaryFolders.source.datasetCensus,
        ),
      ).toString("utf8"),
    ),
    keys = new Set<string>(),
    receipts: NativeLineageRemapResult["receipts"][number][] = [];
  for (const item of input.receipts) {
    const { receiptSha256, ...body } = item.receipt,
      receipt = item.receipt,
      key = JSON.stringify([
        receipt.sourceId,
        receipt.version,
        receipt.schema,
        receipt.table,
      ]);
    if (
      keys.has(key) ||
      nativeDigest(body) !== receiptSha256 ||
      receipt.identityPlanSha256 !== parentPlan.sha256 ||
      receipt.usersSha256 !== usersSha256
    )
      fail("receipt_changed");
    keys.add(key);
    const dataset = census.datasets.find(
      (dataset: any) =>
        dataset.id === receipt.sourceId && dataset.version === receipt.version,
    );
    if (!dataset || dataset.rowSha256 !== nativeDigest(dataset.row))
      fail("current_dataset_missing");
    const tables = host.tables(
        dataset.row.meta,
        receipt.sourceId,
        receipt.version,
      ),
      matches = tables.filter(
        (table) =>
          table.schema === receipt.schema && table.table === receipt.table,
      );
    if (matches.length !== 1) fail("typed_table_missing");
    const table = matches[0]!;
    if (
      nativeDigest(table) !==
      nativeDigest(
        Object.fromEntries(
          Object.keys(table).map((key) => [
            key,
            receipt[key as keyof typeof receipt],
          ]),
        ),
      )
    )
      fail("typed_table_changed");
    const [sourceBytes, targetBytes] = await Promise.all([
      host.read(item.sourcePath),
      host.read(item.targetPath),
    ]);
    if (
      sourceBytes.length !== receipt.sourceBytes ||
      bytesSha(sourceBytes) !== receipt.sourceSha256 ||
      targetBytes.length !== receipt.targetBytes ||
      bytesSha(targetBytes) !== receipt.targetSha256
    )
      fail("object_bytes_changed");
    const derived = host.derive(
      table,
      sourceBytes,
      nextUsers,
      extension.plan.sha256,
    );
    if (
      !derived ||
      Buffer.compare(Buffer.from(derived.bytes), Buffer.from(targetBytes)) !== 0
    )
      fail("derived_object_changed");
    const {
      receiptSha256: newReceiptSha,
      identityPlanSha256: newPlanSha,
      ...newBody
    } = derived.receipt;
    const { identityPlanSha256: oldPlanSha, ...oldBody } = body;
    void oldPlanSha;
    if (
      newPlanSha !== extension.plan.sha256 ||
      nativeDigest(newBody) !== nativeDigest(oldBody) ||
      nativeDigest({ ...newBody, identityPlanSha256: newPlanSha }) !==
        newReceiptSha
    )
      fail("reattestation_changed");
    receipts.push({ ...item, receipt: derived.receipt });
  }
  const body = {
    parentIdentityPlanSha256: parentPlan.sha256,
    identityPlanSha256: extension.plan.sha256,
    extensionSha256: extension.sha256,
    usersSha256,
    receipts,
  };
  return { ...body, sha256: nativeDigest(body) };
}
/** Reuse the actual target typed-user mapper and explicit local paths; never a copied row transformer. */
export async function reattestNativeLineageRemapsOffline(
  input: NativeLineageRemapInput,
  options: { targetRoot: string },
): Promise<NativeLineageRemapResult> {
  const { readFile } = await import("node:fs/promises"),
    { pathToFileURL } = await import("node:url"),
    { resolve } = await import("node:path");
  const actual = await import(
    pathToFileURL(
      resolve(
        options.targetRoot,
        "services/app/lib/native-history-import/catalog-user-remap.ts",
      ),
    ).href
  );
  return reattestNativeLineageRemaps(input, {
    read: async (path) => readFile(path),
    tables: actual.nativeCatalogUserTables,
    derive: (table, bytes, users, sha) =>
      actual.deriveNativeUserObject(table, Buffer.from(bytes), users, sha),
  });
}
