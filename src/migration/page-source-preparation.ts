import { prepareForSave } from "../page/page-model.ts";
import type { PlannedPage } from "./contracts.ts";
/** The ordinary HTML save boundary is identical for import and later independent comparison. */
export function prepareMigrationPageSources(page: PlannedPage, origin: string) {
  const reserved = new Set<string>();
  for (const revision of page.revisions)
    for (const id of Object.values(revision.conversion.identities))
      reserved.add(id);
  for (const row of page.identities)
    if (typeof row.source_id === "string") reserved.add(row.source_id);
  return page.revisions.map((revision) => ({
    version: revision.version,
    prepared: prepareForSave(revision.conversion.html!, {
      id: page.pageId,
      version: revision.version,
      origin,
      knownOrigins: [],
      reserved,
    }),
  }));
}
