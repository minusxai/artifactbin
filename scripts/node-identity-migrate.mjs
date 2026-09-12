#!/usr/bin/env node
/**
 * SOURCE NODE IDENTITY BACKFILL — the operator's front door to
 * `POST /api/admin/node-identity`.
 *
 * Deploy the compatibility release FIRST. It must understand stamped source
 * ids, the lifetime reservation and alias tables, multi-change edit history
 * and legacy annotation anchors before any document is converted, and that
 * exact build is the sole rollback target.
 *
 *   ADMIN__SECRET=… node scripts/node-identity-migrate.mjs --url https://artifact.example
 *   ADMIN__SECRET=… node scripts/node-identity-migrate.mjs --url https://artifact.example --apply --batch-size 25
 *
 * Dry run is the default; apply only after reading the preview. Each artifact
 * — its source materialization, history/edit record, comment targets, aliases,
 * reservations and the cursor advance — commits atomically, and the cursor is
 * durable, so a retry resumes rather than repeats. A duplicate legacy anchor
 * or a history-cap conflict answers 409, stops the run and leaves that
 * artifact and the cursor untouched: inspect it, never move the cursor past
 * it, and never bulk-repoint annotations by key.
 *
 * Rollback is compatibility-only — stop and redeploy the verified release.
 * There is no reverse backfill: older code treats comment anchors as
 * source-writing metadata and cannot safely edit a converted document.
 */
import { pathToFileURL } from 'node:url';

import { migrationRequest, parseMigrationArgs, redactingWriter, runMigrationMain } from './lib/migration-cli.mjs';

export { parseMigrationArgs };

export async function runMigrationCli(options) {
  const write = redactingWriter(options.secret, options.write);
  const endpoint = `${options.url}/api/admin/node-identity`;
  let lastCursor;
  for (;;) {
    const result = await migrationRequest({
      fetchFn: options.fetch, endpoint, secret: options.secret, timeoutMs: options.timeoutMs, retries: options.retries, write,
      body: { batchSize: options.batchSize, dryRun: options.dryRun, maxHistoricalVersionsPerArtifact: options.historyLimit ?? 1000 },
    });
    if (result.reason === 'conflict') {
      write(`migration blocked: ${result.report.conflicts.map((c) => `${c.artifactId}:${c.reason}`).join(', ')}`);
      return result;
    }
    if (!result.ok) return result;
    const body = result.report;
    write(`${body.dryRun ? 'dry-run' : 'apply'}: processed=${body.processed} changed=${body.changed} cursor=${body.cursor ?? '-'} done=${body.done}`);
    if (options.dryRun || body.done) return { ok: true, report: body };
    // A successful answer that moved nothing would loop forever.
    if (!(body.processed > 0) || body.cursor === lastCursor) { write('migration stopped: successful response made no cursor progress'); return { ok: false, reason: 'no_progress', report: body }; }
    lastCursor = body.cursor;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrationMain(() => parseMigrationArgs(process.argv.slice(2)), runMigrationCli);
}
