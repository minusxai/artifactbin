import type { HistoricalSourceQueryAuthority } from "./contracts.ts";
/** Server-authored immutable capability; never accepted from page/query input. */
export function assertHistoricalSourceQueryAuthority(
  value: HistoricalSourceQueryAuthority,
  expected: {
    pageLegacyId?: string;
    pageId: string;
    pageVersion: number;
    sourceNamespace: string;
  },
): void {
  if (
    !value ||
    value.kind !== "standalone-external-history-v1" ||
    Object.keys(value).sort().join() !==
      "artifactSha256,editId,headVersion,kind,pageId,pageLegacyId,pageVersion,sourceNamespace" ||
    value.pageId !== expected.pageId ||
    !/^[A-Za-z0-9]{6}$/.test(value.pageId) ||
    value.pageVersion !== expected.pageVersion ||
    !Number.isSafeInteger(value.pageVersion) ||
    value.pageVersion < 1 ||
    !Number.isSafeInteger(value.headVersion) ||
    value.headVersion <= value.pageVersion ||
    value.sourceNamespace !== expected.sourceNamespace ||
    !value.sourceNamespace ||
    !value.pageLegacyId ||
    (expected.pageLegacyId !== undefined &&
      value.pageLegacyId !== expected.pageLegacyId) ||
    typeof value.editId !== "string" ||
    !value.editId ||
    value.editId.length > 1024 ||
    value.editId.includes("\0") ||
    !/^[a-f0-9]{64}$/.test(value.artifactSha256)
  )
    throw Error("Invalid historical source query authority");
}
