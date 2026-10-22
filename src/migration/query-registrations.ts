import { createHash } from "node:crypto";
import type { MigrationSavedQueryRegistration } from "./query-preparation-contracts.ts";
export type { MigrationSavedQueryRegistration } from "./query-preparation-contracts.ts";
import type { PlannedPage } from "./contracts.ts";
import { prepareMigrationPageSources } from "./page-source-preparation.ts";
/** Bind after final link rewriting. Saved HTML digest is never the archived JSX or raw module digest. */
export function migrationPageQueryRegistrations(
  page: PlannedPage,
  sourceNamespace: string,
  origin: string,
): MigrationSavedQueryRegistration[] {
  if (!page.serverQueries?.length) return [];
  const sources = prepareMigrationPageSources(page, origin);
  return page.serverQueries.map((receipt) => {
    const backend = page.backends?.filter(
      (b) => b.pageVersion === receipt.pageVersion && b.linked,
    );
    const source = sources.find((s) => s.version === receipt.pageVersion);
    if (backend?.length !== 1 || !source)
      throw Error("query_saved_tuple_unavailable");
    return {
      sourceNamespace,
      moduleSourceSha256: receipt.moduleSourceSha256,
      migrationProvenance: {
        flowSourceSha256: receipt.flowSourceSha256,
        compilerIdentity: receipt.compilerIdentity,
      },
      plan: {
        ...receipt.plan,
        registration: {
          backendId: backend[0]!.backendId,
          backendVersion: backend[0]!.deployment.version,
          pageId: page.pageId,
          pageVersion: receipt.pageVersion,
          sourceSha256: createHash("sha256")
            .update(source.prepared.source)
            .digest("hex"),
        },
      },
    };
  });
}
