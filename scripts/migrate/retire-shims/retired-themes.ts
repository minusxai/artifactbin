/**
 * RETIRED THEME NAMES TO THEIR SUCCESSORS (`classical` → `manuscript`), in place.
 *
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/retired-themes.ts [--apply]
 *
 * The successor (and the colorMode the retirement implies when the row pinned
 * none) comes from lib/data/story/story-themes RETIRED_STORY_THEMES through
 * resolveStoredStoryDesign — the same mapping the read path applies, so a
 * rewritten row renders exactly as it did. Heads (live and trashed) AND archived
 * versions are counted and rewritten: deleting the alias would otherwise make
 * restoring a version that names a retired theme publish a rejected name.
 * A frozen `compiledCss` is left alone; it is stale by version and recompiles on read.
 */
import { RETIRED_STORY_THEMES, resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { isMain, newReport, recordChange, runCli, type BackfillOptions, type BackfillReport } from './common';
import type { Db } from '@/lib/platform/db';

interface Target { scope: string; table: string; key: string; label: string; where: string }
const TARGETS: Target[] = [
  { scope: 'head', table: 'artifacts', key: 'id', label: 'id', where: "format='markup'" },
  { scope: 'version', table: 'artifact_versions', key: 'artifact_id', label: "artifact_id || '@' || version", where: "format='markup'" },
];

export async function run(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  const report = newReport('retired-themes', options);
  const retired = Object.keys(RETIRED_STORY_THEMES);
  for (const target of TARGETS) {
    const rows = (await db.query<{ label: string; id: string; version: number | null; theme: string; color_mode: 'light' | 'dark' | null }>(
      `SELECT ${target.label} AS label, ${target.key} AS id, version AS version, meta->>'theme' AS theme, meta->>'colorMode' AS color_mode
       FROM ${target.table} WHERE ${target.where} AND meta->>'theme' = ANY($1::text[]) ORDER BY 1`, [retired],
    )).rows;
    report.candidates += rows.length;
    report.notes.push(`${target.scope}s naming a retired theme: ${rows.length}`);
    for (const row of rows) {
      const design = resolveStoredStoryDesign(row.theme, row.color_mode);
      if (design.theme == null || design.theme === row.theme) { report.blocked.push({ id: row.label, reason: `${row.theme} has no successor` }); continue; }
      if (options.apply) {
        const patch = JSON.stringify({ theme: design.theme, ...(design.colorMode !== (row.color_mode ?? null) ? { colorMode: design.colorMode } : {}) });
        const exact = target.table === 'artifacts' ? 'id=$1 AND version=$3' : 'artifact_id=$1 AND version=$3';
        const result = await db.transaction(async (tx) => {
          // The predicate is re-checked in the write itself: a row someone re-themed meanwhile no longer matches.
          const done = await tx.query(`UPDATE ${target.table} SET meta=meta||$2::jsonb WHERE ${exact} AND meta->>'theme'=$4`, [row.id, patch, row.version, row.theme]);
          return done.rowCount;
        });
        if (!result) continue;
      }
      recordChange(report, options, row.label);
    }
  }
  report.notes.push('UNLOCKS the RETIRED_STORY_THEMES alias in story-themes.ts once both counts above are 0 after --apply');
  return report;
}

if (isMain(import.meta.url)) await runCli('retired-themes', run);
