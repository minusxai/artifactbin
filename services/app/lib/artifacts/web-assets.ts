/**
 * THE WEB ASSETS A PAGE SERVES ON ITS OWNER'S HOST: `meta.webAssets`, the `web_assets` keys (urlHash) of the
 * http(s) images its stored source names (lib/html-page htmlAssetLinks imageUrls: img/source src, video poster;
 * never fonts, PDFs or links). The owner host answers `/assets/<hash>` only for a hash one of the owner's
 * eligible pages lists (lib/user-pages servesWebAsset, an indexed `meta->'webAssets' ? hash`).
 *
 * Derived from the stored source at the store's two content writes (create, publish), so a replace and a revert
 * (which publishes the restored version) always carry the set of the source they store. `backfillWebAssets` fills
 * pages written before the key existed (scripts/backfill-web-assets.ts, an operator script, never boot).
 *
 * A pure leaf: the operator script bundles it alone (DEEP_MODULES' `web-assets` entry), with no platform import.
 */
import type { Queryable } from '@artifactbin/contracts';
import { urlHash } from '@/lib/document';
import { htmlAssetLinks } from '@/lib/html-page';

/** The sorted, distinct `web_assets` keys of the images an HTML source names. */
export function webAssetHashes(source: string | null): string[] {
  return [...new Set(htmlAssetLinks(source ?? '').imageUrls.map(urlHash))].sort();
}

/** The meta a content write stores: an HTML page's carries the set of the source it stores, any other format none. */
export function withWebAssets(format: string, source: string | null | undefined, meta: Record<string, unknown>): Record<string, unknown> {
  const { webAssets: _derived, ...rest } = meta;
  return format === 'html' ? { ...rest, webAssets: webAssetHashes(source ?? null) } : rest;
}

export interface WebAssetsBackfillReport {
  mode: 'dry-run' | 'apply';
  /** HTML rows without `meta.webAssets` read by this run. */
  scanned: number;
  /** Rows written (apply) or that would be (dry run). */
  written: number;
  /** Of those, rows naming at least one web image. */
  withAssets: number;
  /** Rows republished between this run's read and its write: left for the next run. */
  changed: string[];
  /** HTML rows still without `meta.webAssets` when the run ended (0 after a complete apply). */
  remaining: number;
}

/**
 * Fill `meta.webAssets` on every HTML row (live or trashed: a restore keeps meta) that lacks it, in id order,
 * `chunk` rows per statement. Idempotent and resumable: a row that has the key is never read again, and a write
 * applies only while the row is still at the version it was read at and still lacks the key, so a page published
 * meanwhile keeps the set its own write derived. `onChunk` hears ids and counts only.
 */
export async function backfillWebAssets(
  db: Queryable,
  options: { apply: boolean; chunk?: number; limit?: number; onChunk?: (line: string) => void },
): Promise<WebAssetsBackfillReport> {
  const chunk = options.chunk ?? 200;
  const report: WebAssetsBackfillReport = { mode: options.apply ? 'apply' : 'dry-run', scanned: 0, written: 0, withAssets: 0, changed: [], remaining: 0 };
  let after = '';
  for (let n = 1; options.limit === undefined || report.scanned < options.limit; n++) {
    const size = options.limit === undefined ? chunk : Math.min(chunk, options.limit - report.scanned);
    const rows = (await db.query<{ id: string; version: number; source: string | null }>(
      `SELECT id, version, source FROM artifacts WHERE format = 'html' AND NOT (meta ? 'webAssets') AND id > $1 ORDER BY id LIMIT $2`,
      [after, size],
    )).rows;
    if (!rows.length) break;
    const planned = rows.map((row) => ({ id: row.id, version: row.version, hashes: webAssetHashes(row.source) }));
    let written = planned;
    if (options.apply) {
      const done = new Set((await db.query<{ id: string }>(
        `UPDATE artifacts a SET meta = a.meta || jsonb_build_object('webAssets', v.hashes)
         FROM jsonb_to_recordset($1::jsonb) AS v(id text, version int, hashes jsonb)
         WHERE a.id = v.id AND a.version = v.version AND a.format = 'html' AND NOT (a.meta ? 'webAssets')
         RETURNING a.id`,
        [JSON.stringify(planned)],
      )).rows.map((row) => row.id));
      written = planned.filter((row) => done.has(row.id));
      report.changed.push(...planned.filter((row) => !done.has(row.id)).map((row) => row.id));
    }
    const withAssets = written.filter((row) => row.hashes.length).length;
    report.scanned += rows.length; report.written += written.length; report.withAssets += withAssets;
    after = rows.at(-1)!.id;
    options.onChunk?.(`chunk ${n}: ${rows[0]!.id}..${after} scanned=${rows.length} ${options.apply ? 'written' : 'planned'}=${written.length} with_assets=${withAssets}`);
  }
  report.remaining = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM artifacts WHERE format = 'html' AND NOT (meta ? 'webAssets')`,
  )).rows[0]?.n ?? 0;
  return report;
}
