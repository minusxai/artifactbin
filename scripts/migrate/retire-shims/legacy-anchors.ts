/**
 * LIVE DOCUMENTS STILL CARRYING `data-annotation-anchor`, REPUBLISHED WITH THE ATTRIBUTE RETIRED.
 *
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/legacy-anchors.ts [--apply] [--objects <dir> | --live-objects]
 *
 * The write is the publish path's own: publishMarkupForArtifact stamps node ids with
 * `retireLegacyAliases: true` (a node with no `id` takes its legacy key as its
 * id, or an alias is recorded), and commitNormalizedMarkup commits the new version
 * and repoints annotations to aliased ids — under the row lock, the way
 * scripts/migrate/sqlite/apply-hand-conversion does. The publish door still
 * validates, so a document it refuses is reported, not forced.
 *
 * A row is refused BEFORE any write if an annotation of the document is anchored by a key the
 * stamped source would no longer resolve (neither as an id nor as a recorded alias).
 * Trashed documents are listed but not written: they cannot go through the publish
 * door, and the same stamping runs when one is restored and edited. Archived
 * versions carrying the attribute are only counted (loadArtifactDocument stamps them on read).
 */
import { anchorIndex, sourceWithoutAnchors } from '@/lib/annotations/anchors';
import { commitNormalizedMarkup, getArtifactById, publishMarkupForArtifact } from '@/lib/artifacts';
import { artifactQuery } from '@/lib/artifacts/document';
import { stampNodeIds } from '@/lib/story/document/node-ids';
import { isMain, newReport, recordChange, runCli, type BackfillOptions, type BackfillReport } from './common';
import type { Db } from '@/lib/platform/db';

const CANDIDATES = `format='markup' AND (source LIKE '%data-annotation-anchor%' OR document::text LIKE '%data-annotation-anchor%')`;

export async function run(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  const report = newReport('legacy-anchors', options);
  const heads = (await db.query<{ id: string; deleted: boolean }>(`SELECT id, deleted_at IS NOT NULL AS deleted FROM artifacts WHERE ${CANDIDATES} ORDER BY id`)).rows;
  const archived = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM artifact_versions WHERE ${CANDIDATES}`)).rows[0]?.n ?? 0;
  report.notes.push(`archived versions matching the filter (not written; stamped on read): ${archived}`);
  for (const { id, deleted } of heads) {
    // The filter is textual; the attribute itself is what counts. A trashed head is not served by getArtifactById.
    const current = deleted
      ? (await artifactQuery<Awaited<ReturnType<typeof getArtifactById>> & object>(db, 'SELECT * FROM artifacts WHERE id=$1', [id])).rows[0]
      : await getArtifactById(id);
    if (!current || current.format !== 'markup' || !current.source) continue;
    if (sourceWithoutAnchors(current.source) === current.source) continue;
    report.candidates++;
    if (deleted) { report.blocked.push({ id, reason: 'trashed: not republished; stamped when restored and edited' }); continue; }
    const reserved = (await db.query<{ source_id: string }>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1', [id])).rows.map((row) => row.source_id);
    const stamped = stampNodeIds(current.source, { previousSource: current.source, reservedIds: reserved, retireLegacyAliases: true });
    const resolvable = new Set([...anchorIndex(stamped.source).keys(), ...stamped.aliases.map((alias) => alias.legacyKey)]);
    const anchors = (await db.query<{ anchor_key: string }>('SELECT DISTINCT anchor_key FROM annotations WHERE artifact_id=$1 AND anchor_key IS NOT NULL', [id])).rows;
    const lost = anchors.map((row) => row.anchor_key).filter((key) => !resolvable.has(key));
    if (lost.length) { report.blocked.push({ id, reason: `annotation anchor(s) ${lost.join(', ')} would stop resolving` }); continue; }
    // Prepared outside the transaction (the publish door reads on its own connection), committed under the row lock.
    const prepared = await publishMarkupForArtifact(current, current.source);
    if (prepared instanceof Response) { report.blocked.push({ id, reason: `the publish door refused (${prepared.status}): ${await prepared.text()}` }); continue; }
    if (options.apply) {
      const written = await db.transaction(async (tx) => {
        const locked = (await artifactQuery<typeof current>(tx, 'SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
        if (!locked || locked.edit_id !== current.edit_id) return false;
        const committed = await commitNormalizedMarkup(tx, null, locked, prepared);
        await tx.query('UPDATE artifacts SET meta=meta||$2::jsonb WHERE id=$1', [id, JSON.stringify({ legacyAnchorsRetired: { job: 'retire-shims:legacy-anchors', from: locked.version, version: committed.version } })]);
        return true;
      });
      if (!written) { report.blocked.push({ id, reason: 'changed while it was being prepared; run again' }); continue; }
    }
    recordChange(report, options, id);
  }
  report.notes.push(heads.length
    ? 'after --apply, re-run: a count of 0 live and 0 trashed lets the alias branches of anchors.ts / document.ts / node-ids.ts be considered (the alias table stays while archived versions carry it)'
    : 'no document carries the attribute');
  return report;
}

if (isMain(import.meta.url)) await runCli('legacy-anchors', run, { services: true });
