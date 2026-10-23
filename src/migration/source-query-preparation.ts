import { assertHistoricalSourceQueryAuthority } from "../datasets/source-query/historical-authority.ts";
import type { MigrationSourceQueryRegistration } from "../datasets/source-query/contracts.ts";
import { validateSourceRegistration } from "../datasets/source-query/sql.ts";
import { readLegacySourceQuerySites } from "./conversion/compiled/source-query-source.ts";
/** Only the exact current source declarations can activate an operator-attested resource. */
export function attestMigrationSourceQueries(
  source: string,
  legacyId: string,
  version: number,
  registrations: readonly MigrationSourceQueryRegistration[] = [],
): MigrationSourceQueryRegistration[] {
  const selected = registrations.filter(
    (r) => r.pageLegacyId === legacyId && r.pageVersion === version,
  );
  if (!selected.length) return [];
  const sites = readLegacySourceQuerySites(source);
  if (sites.length !== selected.length)
    throw Error("Incomplete source query attestation");
  const names = new Set<string>();
  for (const registration of selected) {
    validateSourceRegistration(registration);
    const site = sites.find((s) => s.name === registration.name);
    if (
      registration.resource !== `source-${registration.sourceRef.slice(4)}` ||
      names.has(registration.name) ||
      !site ||
      site.sourceRef !== registration.sourceRef ||
      site.sql !== registration.sql ||
      site.sqlSha256 !== registration.sqlSha256
    )
      throw Error("Source query declaration differs");
    names.add(registration.name);
  }
  return selected;
}

import type { MigrationSourceQueryBatch } from "./source-query-contracts.ts";
import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
import { canonicalMigrationValue as canonical } from "./verification-values.ts";
export function validateMigrationSourceQueryBatch(
  metadata: DatasetImportMetadata,
  groups: readonly MigrationSourceQueryBatch[] = [],
  trusted: readonly MigrationSourceQueryRegistration[] = [],
): void {
  const expected = trusted.filter((q) =>
    metadata.pages.some(
      (p) =>
        p.snapshot.id === q.pageLegacyId && p.pageVersion === q.pageVersion,
    ),
  );
  const actual: MigrationSourceQueryRegistration[] = [];
  const identities = new Set<string>();
  for (const group of groups) {
    const r = group.receipt;
    if (
      !/^[A-Za-z0-9]{6}$/.test(r.backendId) ||
      !metadata.pages.some(
        (p) =>
          p.pageId === r.pageId &&
          p.pageVersion === r.pageVersion &&
          p.snapshot.id === r.pageLegacyId,
      ) ||
      !group.queries.length
    )
      throw Error("Invalid source query saved page authority");
    if (r.historicalSourceQueries) {
      assertHistoricalSourceQueryAuthority(r.historicalSourceQueries, {...r, sourceNamespace:metadata.sourceNamespace});
      const page=metadata.pages.find(p=>p.pageId===r.pageId && p.pageVersion===r.pageVersion)!;
      if (page.snapshot.format!=="dataset" || page.snapshot.editId!==r.historicalSourceQueries.editId) throw Error("Invalid historical source query page provenance");
    }
    for (const query of group.queries) {
      validateSourceRegistration(query);
      if (
        query.pageLegacyId !== r.pageLegacyId ||
        query.pageVersion !== r.pageVersion
      )
        throw Error("Source query receipt mismatch");
      const key = JSON.stringify([
        query.pageLegacyId,
        query.pageVersion,
        query.name,
      ]);
      if (identities.has(key))
        throw Error("Duplicate source query registration");
      identities.add(key);
      actual.push(query);
    }
  }
  const ordered = (queries: readonly MigrationSourceQueryRegistration[]) =>
    queries.map((q) => canonical(q)).sort();
  if (canonical(ordered(expected)) !== canonical(ordered(actual)))
    throw Error("Source query trusted registration scope differs");
}
