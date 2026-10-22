import { migrationPageDigest } from "./import.ts";
import { rewriteMigrationLinks } from "./links.ts";
import type { PlannedPage } from "./contracts.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
  MigrationJobPlan,
  MigrationPagePlanner,
} from "./job-contracts.ts";
/** Reproduce only globally admitted pages, refusing changed conversion or authority before final link rewriting. */
export async function* readPreparedMigrationPages(
  source: MigrationJobSource,
  options: MigrationJobOptions,
  planned: MigrationJobPlan,
  planner: MigrationPagePlanner,
): AsyncGenerator<PlannedPage> {
  const ready = new Set(planned.readiness.ready);
  for (const id of source.ids) {
    if (!ready.has(source.maps.pages[id]!)) continue;
    const plan = await planner(await source.readArtifact(id));
    for (const page of plan.pages) {
      if (migrationPageDigest(page) !== planned.pageDigests.get(page.pageId))
        throw Error("Prepared source plan changed");
      for (const revision of page.revisions)
        if (revision.conversion.html !== null)
          revision.conversion.html = rewriteMigrationLinks(
            revision.conversion.html,
            source.maps,
            {
              legacyOrigins: options.legacyOrigins,
              targetOrigin: options.origin,
              readyPages: ready,
            },
          );
      yield page;
    }
  }
}
