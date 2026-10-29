import {createHash} from 'node:crypto';
import { getDb } from '@/lib/platform';
import type {HtmlPageLink} from '@artifactbin/contracts';

/*
 * A DATASET'S MARK: everything about its row that changes when what a reader
 * may see of it does — its rows (version, edit id, stored meta), who may read
 * it (visibility, link role, shares, policy) and whether it exists. Opaque and
 * short; a spurious difference costs one re-run, never a missed one.
 */
const MARK_SQL = `SELECT id, version, edit_id, visibility, link_role, sharing_revision, policy_revision, deleted_at IS NULL AS live, md5(meta::text) AS meta
  FROM artifacts WHERE id = ANY($1::text[])`;

/** The current mark of each of these datasets; a missing one has none. Also the guest snapshots' freshness rule (lib/publish/prepared/snapshots.server). */
export async function marksOf(ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = (await (await getDb()).query<{ id: string }>(MARK_SQL, [[...ids]])).rows;
  return new Map(rows.map((r) => [r.id, createHash('sha256').update(JSON.stringify(r)).digest('base64url').slice(0, 12)]));
}

const TOKEN_PART = /^([A-Za-z0-9]+)\.([A-Za-z0-9_-]{12})$/;

/** `id.mark~id.mark` — what a page hands its live stream (`?since=`). */
export const tokenOf = (marks: Map<string, string>): string => [...marks].sort(([a], [b]) => a.localeCompare(b)).map(([id, mark]) => `${id}.${mark}`).join('~');

/** The marks a token names (`id.mark~id.mark`); one that does not parse names nothing. */
export function marksOfToken(since: string | null): Map<string, string> {
  const then = new Map<string, string>();
  if (!since || since.length > 4096) return then;
  for (const part of since.split('~')) {
    const m = TOKEN_PART.exec(part);
    if (m) then.set(m[1]!, m[2]!);
  }
  return then;
}

/**
 * The datasets among `followed` whose mark has moved since `since` (a token a
 * served page carried). Only ids the token names are judged: a dataset the
 * page was not served from is not its to report, and a token that does not
 * parse names nothing.
 */
export async function changedSince(since: string | null, followed: Iterable<string>): Promise<string[]> {
  const then = marksOfToken(since);
  const judged = [...new Set(followed)].filter((id) => then.has(id));
  if (!judged.length) return [];
  const now = await marksOf(judged);
  return judged.filter((id) => now.get(id) !== then.get(id));
}

/** Archived pinned bindings do not follow mutable dataset heads. */
export function liveDatasetIds(links:readonly HtmlPageLink[]):string[]{return [...new Set(links.flatMap(link=>link.kind==='dataset'&&link.mode==='live'?[link.datasetId]:[]))];}
