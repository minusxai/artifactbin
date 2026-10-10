/**
 * LIVE DOCUMENTS STILL CARRYING `data-annotation-anchor`, REPUBLISHED WITHOUT IT.
 *
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/legacy-anchors.ts [--apply] [--detach-orphaned-anchors] [--objects <dir> | --live-objects]
 *
 * The app no longer reads the attribute (comments anchor to a node's `id` and nothing else), so
 * this script owns the whole one-off transform, as data, before the publish door sees the source:
 * every attribute is removed, and an element with no `id` whose legacy key is a usable, unclaimed
 * id takes that key as its `id` (its comments keep resolving unchanged). Every other legacy key is
 * mapped to the id its element ends up with, and the comments anchored by it are repointed in the
 * same transaction as the new version. The write is the publish path's own
 * (publishMarkupForArtifact + commitNormalizedMarkup, under the row lock), so a document the
 * publish door refuses is reported, not forced.
 *
 * A comment anchored by a key that names no node of the republished document — neither an id nor
 * a legacy key on an element — would stop resolving. Without `--detach-orphaned-anchors` such a
 * document is blocked before any write; with it, the document is republished anyway and each such
 * root comment's `anchor_key` becomes NULL (an unanchored comment the reader shows without a
 * highlight), logged by id. A second run finds no attribute and no candidate: it is a no-op.
 *
 * Trashed documents are listed, not written: they cannot go through the publish door. Archived
 * versions carrying the attribute are only counted: they are read as stored, where the attribute
 * is inert.
 */
import { parseJsx, serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { sourceWithoutAnchors, ANNOTATION_ANCHOR_ATTR, nodeIndex } from '@/lib/document';
import { artifactQuery, commitNormalizedMarkup, getArtifactById } from '@/lib/artifacts';
import { publishMarkupForArtifact } from '@/lib/publish/publish';
import { isMain, newReport, recordChange, runCli, type BackfillOptions, type BackfillReport } from './common';
import type { Db } from '@/lib/platform/db';

const CANDIDATES = `format='markup' AND (source LIKE '%data-annotation-anchor%' OR document::text LIKE '%data-annotation-anchor%')`;

/** A static, whitespace-free string attribute value — what the stamper accepts as an id. */
function staticString(node: JsxElement, name: string): string | null {
  const value = node.attributes.find((a) => a.name === name)?.value;
  return value?.static && typeof value.json === 'string' && value.json !== '' && !/[\t\n\f\r ]/.test(value.json) ? value.json : null;
}

interface Retired {
  /** The source without the attribute, legacy keys promoted to ids where they can be. */
  source: string;
  /** Each legacy key, by the body path (lib/document/node-ids) of the element that carried it. */
  keys: Array<{ key: string; path: string }>;
}

/**
 * The one-off transform. Paths are the stamper's own (body elements, Helmet skipped), so the
 * prepared source's `nodeIndex` names the id each carrier ended up with. Exported for the test.
 */
export function retireAnchorAttributes(source: string): Retired {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`invalid JSX: ${parsed.error}`);
  const carriers: Array<{ node: JsxElement; path: string; key: string | null }> = [];
  const claimed = new Set<string>();
  const walk = (list: JsxNode[], prefix: string) => {
    list.forEach((node, index) => {
      if (node.type !== 'element' || node.tag === 'Helmet') return;
      const path = prefix ? `${prefix}.${index}` : String(index);
      const id = staticString(node, 'id');
      if (id && !node.control) claimed.add(id);
      if (node.attributes.some((a) => a.name === ANNOTATION_ANCHOR_ATTR)) carriers.push({ node, path, key: staticString(node, ANNOTATION_ANCHOR_ATTR) });
      walk(node.children, path);
    });
  };
  walk(parsed.nodes, '');
  const keys: Retired['keys'] = [];
  for (const { node, path, key } of carriers) {
    node.attributes = node.attributes.filter((a) => a.name !== ANNOTATION_ANCHOR_ATTR);
    if (!key || node.control) continue;
    if (!staticString(node, 'id') && !claimed.has(key)) {
      node.attributes = node.attributes.filter((a) => a.name !== 'id');
      node.attributes.push({ name: 'id', value: { static: true, json: key }, start: node.start, end: node.start });
      claimed.add(key);
    }
    keys.push({ key, path });
  }
  return { source: serializeJsx(parsed.nodes), keys };
}

export async function run(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  const report = newReport('legacy-anchors', options);
  const heads = (await db.query<{ id: string; deleted: boolean }>(`SELECT id, deleted_at IS NOT NULL AS deleted FROM artifacts WHERE ${CANDIDATES} ORDER BY id`)).rows;
  const archived = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM artifact_versions WHERE ${CANDIDATES}`)).rows[0]?.n ?? 0;
  report.notes.push(`archived versions matching the filter (not written; read as stored, the attribute inert): ${archived}`);
  let detached = 0;
  for (const { id, deleted } of heads) {
    // The filter is textual; the attribute itself is what counts. A trashed head is not served by getArtifactById.
    const current = deleted
      ? (await artifactQuery<Awaited<ReturnType<typeof getArtifactById>> & object>(db, 'SELECT * FROM artifacts WHERE id=$1', [id])).rows[0]
      : await getArtifactById(id);
    if (!current || current.format !== 'markup' || !current.source) continue;
    if (sourceWithoutAnchors(current.source) === current.source) continue;
    report.candidates++;
    if (deleted) { report.blocked.push({ id, reason: 'trashed: not republished' }); continue; }
    let retired: Retired;
    try { retired = retireAnchorAttributes(current.source); }
    catch (error) { report.blocked.push({ id, reason: `the stored source does not parse: ${error instanceof Error ? error.message : String(error)}` }); continue; }
    const twice = retired.keys.map((k) => k.key).filter((key, i, all) => all.indexOf(key) !== i);
    if (twice.length) { report.blocked.push({ id, reason: `legacy key(s) ${[...new Set(twice)].join(', ')} name more than one element: a person must choose` }); continue; }
    // Prepared outside the transaction (the publish door reads on its own connection), committed under the row lock.
    const prepared = await publishMarkupForArtifact(current, retired.source);
    if (prepared instanceof Response) { report.blocked.push({ id, reason: `the publish door refused (${prepared.status}): ${await prepared.text()}` }); continue; }
    const index = nodeIndex(prepared.source);
    const idAt = new Map([...index.values()].map((entry) => [entry.path, entry.id]));
    const mapped = new Map(retired.keys.flatMap(({ key, path }) => (idAt.has(path) ? [[key, idAt.get(path)!] as const] : [])));
    const anchors = (await db.query<{ id: string; anchor_key: string }>('SELECT id, anchor_key FROM annotations WHERE artifact_id=$1 AND anchor_key IS NOT NULL ORDER BY id', [id])).rows;
    // A legacy key names its carrier, even where another element's id spells the same key.
    const repoint = anchors.filter((a) => mapped.has(a.anchor_key) && mapped.get(a.anchor_key) !== a.anchor_key).map((a) => ({ ...a, to: mapped.get(a.anchor_key)! }));
    const lost = anchors.filter((a) => !index.has(a.anchor_key) && !mapped.has(a.anchor_key));
    if (lost.length && !options.detachOrphanedAnchors) {
      report.blocked.push({ id, reason: `annotation anchor(s) ${[...new Set(lost.map((a) => a.anchor_key))].join(', ')} would stop resolving (--detach-orphaned-anchors republishes anyway)` });
      continue;
    }
    if (options.apply) {
      const written = await db.transaction(async (tx) => {
        const locked = (await artifactQuery<typeof current>(tx, 'SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id])).rows[0];
        if (!locked || locked.edit_id !== current.edit_id) return false;
        const committed = await commitNormalizedMarkup(tx, null, locked, prepared);
        for (const a of repoint) await tx.query('UPDATE annotations SET anchor_key=$3 WHERE artifact_id=$1 AND id=$2 AND anchor_key=$4', [id, a.id, a.to, a.anchor_key]);
        for (const a of lost) await tx.query('UPDATE annotations SET anchor_key=NULL WHERE artifact_id=$1 AND id=$2 AND anchor_key=$3', [id, a.id, a.anchor_key]);
        await tx.query('UPDATE artifacts SET meta=meta||$2::jsonb WHERE id=$1', [id, JSON.stringify({ legacyAnchorsRetired: { job: 'retire-shims:legacy-anchors', from: locked.version, version: committed.version } })]);
        return true;
      });
      if (!written) { report.blocked.push({ id, reason: 'changed while it was being prepared; run again' }); continue; }
    }
    const verb = options.apply ? 'detached' : 'would detach';
    for (const a of lost) options.log?.(`${verb} ${id} annotation ${a.id} (anchor ${a.anchor_key})`);
    for (const a of repoint) options.log?.(`${options.apply ? 'repointed' : 'would repoint'} ${id} annotation ${a.id} (anchor ${a.anchor_key} -> ${a.to})`);
    detached += lost.length;
    recordChange(report, options, id);
  }
  if (options.detachOrphanedAnchors) report.notes.push(`annotation anchors ${options.apply ? 'detached' : 'that would be detached'}: ${detached}`);
  report.notes.push(heads.length ? 'after --apply, re-run: 0 candidates means no live document carries the attribute' : 'no document carries the attribute');
  return report;
}

if (isMain(import.meta.url)) await runCli('legacy-anchors', run, { services: true, detach: true });
