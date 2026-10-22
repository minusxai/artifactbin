import { createHash } from "node:crypto";
import { additiveRowSha256 } from "../dataset-pages/additive-authority.ts";
import type {
  LegacyRow,
  MigrationManifest,
  MigrationMaps,
} from "../contracts.ts";
import type { StandaloneVizJobAdmission } from "./admission-contracts.ts";
export function admitStandaloneVizSources(
  manifests: readonly MigrationManifest[],
  maps: MigrationMaps,
  admission: Pick<
    StandaloneVizJobAdmission,
    "kind" | "sourceNamespace" | "heads"
  >,
): { legacyId: string; pageId: string; version: number; row: LegacyRow }[] {
  if (
    admission.kind !== "standalone-viz-pages-v1" ||
    !admission.heads.length ||
    new Set(admission.heads.map((h) => h.legacyId)).size !==
      admission.heads.length ||
    new Set(admission.heads.map((h) => h.pageId)).size !==
      admission.heads.length ||
    manifests.length !== admission.heads.length
  )
    throw Error("Invalid visualization admission scope");
  const seen = new Set<string>(),
    output = [];
  for (const manifest of manifests) {
    if (
      manifest.sourceNamespace !== admission.sourceNamespace ||
      manifest.artifacts.length !== 1
    )
      throw Error("Visualization source namespace or scope changed");
    const row = manifest.artifacts[0]!,
      head = admission.heads.find((h) => h.legacyId === row.id);
    if (
      !head ||
      seen.has(row.id) ||
      row.deleted_at ||
      row.format !== "viz" ||
      row.version !== head.version ||
      maps.pages[row.id] !== head.pageId ||
      !/^[A-Za-z0-9]{6}$/.test(head.pageId) ||
      additiveRowSha256(row) !== head.artifactSha256 ||
      typeof row.source !== "string" ||
      createHash("sha256").update(row.source).digest("hex") !==
        head.sourceSha256
    )
      throw Error("Visualization source or destination identity changed");
    seen.add(row.id);
    const history = (manifest.tables.artifact_versions ?? []).filter(
      (r) => r.artifact_id === row.id && Number(r.version) !== row.version,
    );
    const rows = [...history, row].sort(
      (a, b) => Number(a.version) - Number(b.version),
    );
    if (
      rows.length !== head.versions.length ||
      new Set(rows.map((r) => Number(r.version))).size !== rows.length
    )
      throw Error("Visualization saved history changed");
    for (const original of rows) {
      const version = Number(original.version),
        expected = head.versions.find((v) => v.version === version);
      if (
        !Number.isSafeInteger(version) ||
        version < 1 ||
        original.format !== "viz" ||
        typeof original.source !== "string" ||
        !expected ||
        additiveRowSha256(original) !== expected.artifactSha256
      )
        throw Error("Visualization saved source changed");
      output.push({
        legacyId: row.id,
        pageId: head.pageId,
        version,
        row: original,
      });
    }
  }
  return output;
}
