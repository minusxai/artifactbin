import { createHash } from "node:crypto";
import { sourceDigest, type SourceRevision } from "../server/page-ports.ts";
import { prepareForSave } from "../page/page-model.ts";
import type { PlannedPage } from "./contracts.ts";
export interface MigrationPreparedPageSource {
  version: number;
  prepared: ReturnType<typeof prepareForSave>;
  /** Ordinary browser/server readable revision, distinct from raw byte provenance. */
  sourceRevision: SourceRevision;
  /** Plain UTF8 content hash for provenance, never a browser source revision. */
  sourceSha256: string;
}
/** The ordinary HTML save boundary is identical for import and later independent comparison. */
export function prepareMigrationPageSources(page: PlannedPage, origin: string): MigrationPreparedPageSource[] {
  const reserved = new Set<string>();
  for (const revision of page.revisions)
    for (const id of Object.values(revision.conversion.identities))
      reserved.add(id);
  for (const row of page.identities)
    if (typeof row.source_id === "string") reserved.add(row.source_id);
  return page.revisions.map((revision) => {
    const prepared = prepareForSave(revision.conversion.html!, {
      id: page.pageId, version: revision.version, origin, knownOrigins: [], reserved,
    });
    return { version: revision.version, prepared,
      sourceRevision: sourceDigest(prepared.source),
      sourceSha256: createHash("sha256").update(prepared.source).digest("hex"),
    };
  });
}
