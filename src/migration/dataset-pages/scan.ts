import { createHash } from "node:crypto";
import { canonical } from "../datasets/catalog.ts";
import {
  originalMigrationOwner,
  resolveMigrationOwnership,
} from "../ownership-override.ts";
import type {
  MigrationJobSource,
  MigrationJobOptions,
} from "../job-contracts.ts";
import type { LegacyRow } from "../contracts.ts";
import type { MigrationBackendPage } from "../backend-preparation-contracts.ts";
/** Exact complete source-row identity, not a digest of its generated HTML. */
export const datasetPageArtifactSha256 = (row: LegacyRow): string =>
  createHash("sha256").update(canonical(row)).digest("hex");
export async function scanStandaloneDatasetPages(
  source: MigrationJobSource,
  options: MigrationJobOptions,
) {
  const admission = options.standaloneDatasetPages;
  if (
    !admission ||
    admission.kind !== "standalone-dataset-pages-v1" ||
    admission.sourceNamespace !== source.manifest.sourceNamespace ||
    !admission.heads.length
  )
    throw Error("Invalid standalone dataset admission");
  const unique = new Set<string>();
  const pages: MigrationBackendPage[] = [];
  const issues = new Map<string, string[]>();
  for (const expected of admission.heads) {
    if (
      unique.has(expected.legacyId) ||
      !source.ids.includes(expected.legacyId) ||
      !Number.isSafeInteger(expected.version) ||
      expected.version < 1 ||
      !/^[a-f0-9]{64}$/.test(expected.artifactSha256)
    )
      throw Error("Invalid standalone dataset scope");
    unique.add(expected.legacyId);
    const artifact = await source.readArtifact(expected.legacyId);
    const head = artifact.artifacts[0]!;
    if (
      head.id !== expected.legacyId ||
      head.format !== "dataset" ||
      head.deleted_at ||
      head.version !== expected.version ||
      datasetPageArtifactSha256(head) !== expected.artifactSha256
    )
      throw Error("Standalone dataset source changed");
    const owner = resolveMigrationOwnership(
      head,
      source.manifest.sourceNamespace,
      originalMigrationOwner(
        head,
        source.manifest.sourceNamespace,
        source.maps,
      ),
      options.ownershipOverride,
    ).owner;
    if (
      !owner ||
      !["user", "token"].includes(owner.kind) ||
      !source.maps.pages[head.id]
    )
      throw Error("Standalone dataset owner unavailable");
    const catalog =
      head.meta && typeof head.meta === "object"
        ? (head.meta as Record<string, unknown>).catalog
        : undefined;
    if (
      catalog &&
      typeof catalog === "object" &&
      (catalog as { kind?: unknown }).kind === "postgres"
    ) {
      issues.set(head.id, ["external-registration-required"]);
      continue;
    }
    pages.push({
      legacyId: head.id,
      pageId: source.maps.pages[head.id]!,
      owner: owner as MigrationBackendPage["owner"],
      revisions: [
        {
          version: head.version,
          editId: String(head.edit_id ?? ""),
          standaloneDataset: {
            sourceFormat: "dataset",
            legacyId: head.id,
            pageId: source.maps.pages[head.id]!,
            pageVersion: head.version,
            editId: String(head.edit_id ?? ""),
            artifactSha256: expected.artifactSha256,
          },
          imports: [
            {
              name: "data",
              legacyRef: "ref:" + head.id,
              datasetLegacyId: head.id,
              datasetVersion: head.version,
              mode: "live",
            },
          ],
        },
      ],
    });
  }
  return { pages, issues };
}
