/**
 * THE AUTHOR-SCRIPT AUDIT: every live document's CURRENT head whose Helmet `<script>` no longer builds with today's
 * builder (lib/author-script/author-module.server) — a version stored before an API change, which serves without
 * its script (prepared-page.server `authorScriptErrors`). A SEPARATE ENTRY for scripts/audit-author-scripts alone:
 * no server code uses it, so the index does not carry it.
 *
 * STRICTLY READ-ONLY. The caller hands in its own connection and {@link openReadOnly} turns the whole session
 * read-only (`default_transaction_read_only`) before anything is read, so a write — the audit's or anyone's on that
 * connection — is refused by the database itself. The script parses and builds exactly as preparation does
 * (lib/document storyBodyFor, authorModuleNames, buildAuthorModule); nothing is prepared, compiled or stored.
 */
import type { Queryable } from '@artifactbin/contracts';
import { artifactQuery, LIVE_ARTIFACT_SQL } from '@/lib/artifacts/table';
import { authorModuleNames, buildAuthorModule } from '@/lib/author-script/author-module.server';
import { storyBodyFor } from '../../document';

interface ScriptAuditFailure { id: string; visibility: string; version: number; errors: string[] }
export interface ScriptAuditReport {
  /** Live markup documents read (only those whose stored document names a script at all). */
  scanned: number;
  /** Of those, the ones whose head declares a Helmet script: each was built. */
  scripted: number;
  /** The ones whose script does not build, in id order. */
  failures: ScriptAuditFailure[];
}

/** A connection whose session refuses every write. Throws when the database does not confirm it. */
export async function openReadOnly<C extends Queryable>(connection: C): Promise<C> {
  await connection.query('SET default_transaction_read_only = on');
  const shown = (await connection.query<{ default_transaction_read_only: string }>('SHOW default_transaction_read_only')).rows[0];
  if (shown?.default_transaction_read_only !== 'on') throw new Error('the audit connection did not become read-only');
  return connection;
}

const BATCH = 200;

/** Read every live head with a script, in id order and in batches, and build each one. */
export async function auditAuthorScripts(db: Queryable, opts: { batch?: number } = {}): Promise<ScriptAuditReport> {
  const batch = opts.batch ?? BATCH;
  const report: ScriptAuditReport = { scanned: 0, scripted: 0, failures: [] };
  for (let after = ''; ;) {
    // `document` is the stored graph (decoded to `source` by artifactQuery); a graph whose text never says `script` has none.
    const { rows } = await artifactQuery<{ id: string; visibility: string; version: number; source: string | null }>(db,
      `SELECT id, visibility, version, format, source, document FROM artifacts
       WHERE format = 'markup' AND ${LIVE_ARTIFACT_SQL} AND id > $1 AND (document::text LIKE '%script%' OR source LIKE '%<script%')
       ORDER BY id LIMIT $2`, [after, batch]);
    for (const row of rows) {
      report.scanned += 1;
      const helmet = row.source ? storyBodyFor(row.source)?.content : null;
      if (!helmet?.script) continue;
      report.scripted += 1;
      const built = await buildAuthorModule(helmet.script, authorModuleNames(helmet));
      if (!built.ok) report.failures.push({ id: row.id, visibility: row.visibility, version: Number(row.version), errors: built.errors });
    }
    if (rows.length < batch) return report;
    after = rows[rows.length - 1]!.id;
  }
}

/** One line per failure (`id, visibility, version, error`) and the totals; or the report as JSON. */
export function formatScriptAudit(report: ScriptAuditReport, opts: { json: boolean }): string {
  if (opts.json) return JSON.stringify(report);
  const lines = report.failures.map((f) => `${f.id}, ${f.visibility}, v${f.version}, ${f.errors.join(' | ')}`);
  lines.push(`${report.failures.length} of ${report.scripted} scripted document(s) do not build (${report.scanned} live document(s) read)`);
  return lines.join('\n');
}
