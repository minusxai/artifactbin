import { createHash } from "node:crypto";
import type {
  NativeCanonicalManifest,
  NativeCanonicalPage,
  NativeSelectedPage,
  NativeSelectionIndex,
  NativeSelectionRequest,
  NativeSourceRow,
} from "./contracts.ts";
/** Stable object-key ordering; array order and every JSON value remain significant. */
export function nativeDigest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
const byteDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
function identity(row: NativeSourceRow, id: string): boolean {
  return (
    (row.id === undefined || row.id === id) &&
    (row.artifact_id === undefined || row.artifact_id === id) &&
    (row.id === id || row.artifact_id === id)
  );
}
const payload = (row: NativeSourceRow) =>
  Object.fromEntries(
    ["title", "description", "format", "source", "meta", "document"].map(
      (k) => [k, row[k] ?? null],
    ),
  );
/** Selected input construction only: no converter, destination, network or environment access. */
export async function selectNativeRevisions(
  request: NativeSelectionRequest,
): Promise<NativeSelectionIndex> {
  const { sourceIds, sourceNamespace } = request;
  if (
    !sourceNamespace.trim() ||
    !positive(request.expectedHeads) ||
    !positive(request.expectedRevisions) ||
    sourceIds.length !== request.expectedHeads ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => typeof id !== "string" || !id)
  )
    throw Error("native_selection_invalid");
  const manifest = JSON.parse(
    Buffer.from(request.manifestBytes).toString("utf8"),
  ) as NativeCanonicalManifest;
  if (
    !Array.isArray(manifest.receipts) ||
    !Array.isArray(manifest.failures) ||
    manifest.failures.length
  )
    throw Error("native_selection_manifest");
  const pages: NativeSelectedPage[] = [];
  for (const id of sourceIds) {
    const receipts = manifest.receipts.filter((r) => r.id === id);
    if (receipts.length !== 1) throw Error("native_selection_receipt");
    const receipt = receipts[0]!;
    if (
      !positive(receipt.expectedVersion) ||
      !positive(receipt.distinctRevisions) ||
      !Number.isSafeInteger(receipt.archivedRows) ||
      receipt.archivedRows < 0 ||
      !positive(receipt.bytes) ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      typeof receipt.path !== "string" ||
      (!/^page-[a-zA-Z0-9-]+\.json$/.test(receipt.path) &&
        receipt.path !== "page.json")
    )
      throw Error("native_selection_receipt_invalid");
    const bytes = await request.readFile(receipt.path);
    if (
      bytes.byteLength !== receipt.bytes ||
      byteDigest(bytes) !== receipt.sha256
    )
      throw Error("native_canonical_file_digest");
    const page = JSON.parse(
      Buffer.from(bytes).toString("utf8"),
    ) as NativeCanonicalPage;
    if (
      !Array.isArray(page.heads) ||
      page.heads.length !== 1 ||
      !Array.isArray(page.versions) ||
      page.versions.length !== receipt.archivedRows
    )
      throw Error("native_selection_rows");
    const head = page.heads[0]!;
    if (head.version !== receipt.expectedVersion)
      throw Error("native_selection_head");
    const byVersion = new Map<number, NativeSourceRow[]>();
    for (const row of [...page.heads, ...page.versions]) {
      if (!row || !identity(row, id)) throw Error("native_row_identity");
      if (
        !positive(row.version) ||
        row.version > head.version ||
        !row.document ||
        typeof row.document !== "object"
      )
        throw Error("native_selection_revision");
      const rows = byVersion.get(row.version) ?? [];
      rows.push(row);
      byVersion.set(row.version, rows);
    }
    if (byVersion.size !== receipt.distinctRevisions)
      throw Error("native_revision_count");
    const revisions = [...byVersion]
      .sort(([a], [b]) => a - b)
      .map(([version, rows]) => {
        const original = rows[0]!;
        if (
          rows.some(
            (row) =>
              nativeDigest(payload(row)) !== nativeDigest(payload(original)),
          )
        )
          throw Error("native_revision_conflict");
        return {
          key: { sourceNamespace, sourceId: id, version },
          rowSha256: nativeDigest(original),
          documentSha256: nativeDigest(original.document),
          original,
          matchingArchives: rows.slice(1),
        };
      });
    pages.push({
      sourceId: id,
      headVersion: head.version,
      sourceFile: { ...receipt },
      revisions,
    });
  }
  const revisionCount = pages.reduce(
    (sum, page) => sum + page.revisions.length,
    0,
  );
  if (revisionCount !== request.expectedRevisions)
    throw Error("native_revision_count");
  return {
    sourceNamespace,
    manifestSha256: byteDigest(request.manifestBytes),
    pages,
    headCount: pages.length,
    revisionCount,
  };
}
