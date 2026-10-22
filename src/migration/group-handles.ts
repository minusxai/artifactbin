import { createHash } from "node:crypto";
import { handleProblem, normalizeHandle } from "../server/handles.ts";
import type {
  GroupHandleBaseProof,
  GroupHandleCandidate,
  GroupHandlePlan,
  GroupHandleReceipt,
} from "./group-handles-contracts.ts";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function planGroupHandles(
  base: GroupHandleBaseProof,
  candidates: readonly GroupHandleCandidate[],
): GroupHandlePlan {
  if (
    base.kind !== "verified-base-import" ||
    !base.sourceNamespace ||
    !/^[a-f0-9]{64}$/.test(base.archiveManifestSha256) ||
    !/^[a-f0-9]{64}$/.test(base.reportSha256) ||
    !/^[a-f0-9]{64}$/.test(base.datasetReportSha256) ||
    !/^[a-f0-9]{64}$/.test(base.visualizationReportSha256) ||
    !candidates.length ||
    candidates.length > 1000
  )
    throw Error("Invalid group handle base proof");
  const ids = new Set<string>(),
    actors = new Set<string>(),
    handles = new Set<string>();
  for (const row of candidates) {
    if (
      !row.legacyGroupId ||
      !/^group:[a-f0-9]{64}$/.test(row.actor) ||
      typeof row.sourceHandle !== "string" ||
      normalizeHandle(row.sourceHandle) !== row.sourceHandle ||
      handleProblem(row.sourceHandle) ||
      row.expectedHandle !== null ||
      typeof row.sourceDeleted !== "boolean" ||
      ids.has(row.legacyGroupId) ||
      actors.has(row.actor) ||
      handles.has(row.sourceHandle)
    )
      throw Error("Invalid or colliding group handle candidate");
    ids.add(row.legacyGroupId);
    actors.add(row.actor);
    handles.add(row.sourceHandle);
  }
  const canonical = {
    schemaVersion: 1 as const,
    base: {
      kind: base.kind,
      sourceNamespace: base.sourceNamespace,
      archiveManifestSha256: base.archiveManifestSha256,
      reportSha256: base.reportSha256,
      datasetReportSha256: base.datasetReportSha256,
      visualizationReportSha256: base.visualizationReportSha256,
    },
    candidates: candidates
      .map((row) => ({
        legacyGroupId: row.legacyGroupId,
        actor: row.actor,
        sourceHandle: row.sourceHandle,
        sourceDeleted: row.sourceDeleted,
        expectedHandle: null,
      }))
      .sort((a, b) => (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0)),
  };
  return { ...canonical, sha256: sha256(JSON.stringify(canonical)) };
}
export function groupHandleReceipt(plan: GroupHandlePlan): GroupHandleReceipt {
  return {
    schemaVersion: 1,
    planSha256: plan.sha256,
    baseReportSha256: plan.base.reportSha256,
    datasetReportSha256: plan.base.datasetReportSha256,
    visualizationReportSha256: plan.base.visualizationReportSha256,
    archiveManifestSha256: plan.base.archiveManifestSha256,
    sourceNamespace: plan.base.sourceNamespace,
    candidates: plan.candidates,
  };
}
