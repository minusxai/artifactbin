import { attestMigrationSourceQueries } from "../source-query-preparation.ts";
import { canonicalMigrationValue } from "../verification-values.ts";
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
  if (
    new Set((admission.external ?? []).map((e) => e.legacyId)).size !==
      (admission.external ?? []).length ||
    (admission.external ?? []).some(
      (e) =>
        !admission.heads.some(
          (h) =>
            h.legacyId === e.legacyId &&
            h.version === e.version &&
            h.artifactSha256 === e.artifactSha256,
        ),
    )
  )
    throw Error("Invalid standalone external admission");
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
      if (head.dataset_policy != null)
        throw Error(
          "Standalone external dataset policy requires explicit admission",
        );
      const external = admission.external?.find((e) => e.legacyId === head.id);
      if (!external) {
        issues.set(head.id, ["external-registration-required"]);
        continue;
      }
      const queries = attestMigrationSourceQueries(
        external.declarations,
        head.id,
        head.version,
        external.queries,
      );
      const trusted = (options.sourceQueryRegistrations ?? []).filter(
        (q) => q.pageLegacyId === head.id && q.pageVersion === head.version,
      );
      if (
        !Array.isArray((catalog as { tables?: unknown }).tables) ||
        queries.length !== (catalog as { tables: unknown[] }).tables.length ||
        !queries.length ||
        queries.some(
          (q) =>
            q.sourceRef !== "ref:" + head.id || Object.keys(q.params).length,
        ) ||
        canonicalMigrationValue(queries) !== canonicalMigrationValue(trusted)
      )
        throw Error("Standalone external trusted registration differs");
      pages.push({
        legacyId: head.id,
        pageId: source.maps.pages[head.id]!,
        owner: owner as MigrationBackendPage["owner"],
        revisions: [
          {
            version: head.version,
            editId: String(head.edit_id ?? ""),
            imports: [],
            readsViewer: true,
            sourceQueries: queries,
            standaloneExternalDataset: {
              sourceFormat: "dataset",
              legacyId: head.id,
              pageId: source.maps.pages[head.id]!,
              pageVersion: head.version,
              editId: String(head.edit_id ?? ""),
              artifactSha256: expected.artifactSha256,
            },
          },
        ],
      });
      continue;
    }
    if (admission.external?.some((e) => e.legacyId === head.id))
      throw Error("Standalone external source kind differs");
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
