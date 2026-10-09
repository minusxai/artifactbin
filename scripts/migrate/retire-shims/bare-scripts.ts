/**
 * REPORT-ONLY DETECTOR: live documents whose server handler is a BARE `<script>`.
 *
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/bare-scripts.ts
 *
 * lib/runner/resolve runs a Helmet `<script>` with no attributes as the Lambda
 * when the document has no `<script type="server">` (`serverScript ?? legacy`).
 * The predicate is the runner's own — splitHelmet + bareHelmetScript, the helper
 * resolve.ts calls — so this counts exactly the documents that compat branch
 * serves, not the crude "mentions script" filter (507 candidates in production).
 *
 *   used:     a bare script is the handler (no server script): these break if the branch goes
 *   shadowed: a bare script AND a server script: the bare one is ignored by the runner
 *   invalid:  the Helmet fails validation, so the runner refuses the document either way
 *   unreadable: the stored document does not decode (lib/artifacts/servable refuses it), or reading
 *             it failed: skipped and listed by id, never a crash of the whole report
 *
 * Nothing is written, ever: there is no --apply. The fix for a `used` document is
 * to give its script `type="server"`, which is an author's edit.
 */
import { parseJsx } from '@/lib/jsx';
import { artifactQuery } from '@/lib/artifacts/document';
import { bareHelmetScript, splitHelmet, validateHelmet } from '@/lib/story/document/helmet';
import { isMain, newReport, runCli, type BackfillOptions, type BackfillReport } from './common';
import type { Db } from '@/lib/platform/db';

type Verdict = 'used' | 'shadowed' | 'invalid' | 'none';
type Group = Verdict | 'unreadable';

/** What the runner would do with this source. Exported for the test. */
export function bareScriptVerdict(source: string): Verdict {
  const parsed = parseJsx(source);
  if (!parsed.ok) return 'none';
  const split = splitHelmet(parsed.nodes);
  const bare = bareHelmetScript(split);
  if (!split.helmet || !split.helmet.children.some((child) => child.type === 'element' && child.tag.toLowerCase() === 'script' && !child.attributes.length)) return 'none';
  if (validateHelmet(parsed.nodes).length) return 'invalid';
  if (split.content.serverScript) return 'shadowed';
  return bare ? 'used' : 'none';
}

export async function run(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  if (options.apply) throw new Error('bare-scripts only reports; it has no --apply');
  const report = newReport('bare-scripts', options);
  const ids = (await db.query<{ id: string }>(`SELECT id FROM artifacts WHERE format='markup' AND deleted_at IS NULL ORDER BY id`)).rows;
  const groups: Record<Group, string[]> = { used: [], shadowed: [], invalid: [], none: [], unreadable: [] };
  const unreadable = new Map<string, string>();
  for (const { id } of ids) {
    try {
      const row = (await artifactQuery<{ source: string | null; document: unknown }>(db, 'SELECT source, document FROM artifacts WHERE id=$1', [id])).rows[0];
      // A document that did not decode comes back with no source beside it (lib/artifacts/document).
      if (row?.document != null && row.source == null) { groups.unreadable.push(id); unreadable.set(id, 'the stored document does not decode'); continue; }
      if (!row?.source) continue;
      groups[bareScriptVerdict(row.source)].push(id);
    } catch (error) {
      groups.unreadable.push(id);
      unreadable.set(id, `reading it failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  report.candidates = groups.used.length + groups.shadowed.length + groups.invalid.length + groups.unreadable.length;
  report.changed.push(...groups.used);
  report.notes.push(`live documents scanned: ${ids.length}`, `used (bare script is the handler): ${groups.used.length}`, `shadowed by a server script: ${groups.shadowed.length}`, `invalid helmet: ${groups.invalid.length}`, `unreadable (skipped): ${groups.unreadable.length}`);
  for (const id of groups.used) options.log?.(`used ${id}`);
  for (const id of groups.shadowed) report.blocked.push({ id, reason: 'shadowed: bare script ignored beside a server script' });
  for (const id of groups.invalid) report.blocked.push({ id, reason: 'invalid helmet' });
  for (const id of groups.unreadable) report.blocked.push({ id, reason: `unreadable: ${unreadable.get(id)}` });
  report.notes.push(groups.used.length ? 'resolve.ts bare-script branch must stay until `used` is 0'
    : groups.unreadable.length ? 'no readable document depends on the bare-script branch; the unreadable ones above are unknown'
    : 'no document depends on the bare-script branch: resolve.ts lines for it can go');
  return report;
}

if (isMain(import.meta.url)) await runCli('bare-scripts', run, { reportOnly: true });
