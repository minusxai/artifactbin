/**
 * PRERENDERED MERMAID DRAWINGS — harvested after publish, served as stored SVG,
 * so a reader of a published diagram downloads no Mermaid code.
 *
 * THE FLOW. A write that leaves a head version drawing a `<Mermaid>` queues a
 * harvest for that version (after its transaction commits, never inside it;
 * a reader of a head with no harvest queues one too, which is the backstop for
 * every write path and the backfill for documents published before this).
 * The harvester — started by a composition root, never on import — claims a
 * job under a fenced lease (the export cache's pattern: claim token, lease,
 * retry-after, produced outside any transaction), and has the browser service
 * load the version on each reader SURFACE in each colour mode with the engine
 * forced (`mermaid=engine`, `color=` under the capture key) and hand back what
 * the engine drew (`harvestSvg`). Each drawing is kept when it is one this
 * version draws, of a kind that may be prerendered, inert (./sanitize) and
 * REPRODUCIBLE (a drawing never stored before is drawn a second time, in a
 * fresh page, and must come out the same). Kept drawings are stored
 * content-addressed — engine, mode, palette key, code — and shared by every
 * version and document that draws the same thing.
 *
 * THE READ. `mermaidImagesFor` answers a version's drawings for one surface,
 * both modes, keyed as the island wants them (StoryIslandData.mermaidImages);
 * the component shows one wherever it is offered (components/kit/mermaid).
 * That is sound because a stored drawing depends on nothing of the reader's:
 * its layout is fixed in SVG coordinates, measured by the harvest at unhinted
 * advances, and it CARRIES ITS OWN FONTS — the document's bundled web faces,
 * subset to its characters (./fonts) — so every platform renders its text in
 * the theme's face at the advances it was laid out with. A drawing in a face
 * the app does not bundle (a system font) could not carry it, and is never
 * stored: its readers keep the engine. Publishing never waits on any of this and never fails because
 * of it: the queue insert runs after the commit and swallows its own errors,
 * and a browser that is down only means readers draw with the engine.
 *
 * TWO SURFACES, because the same document is drawn in two contexts that give
 * the host element a different computed type: the served document
 * (`/a/<id>/raw`, `document`) and the app's inline reader (`/a/<id>`,
 * `inline`). Measured: 16px and 14px — so different palettes, so different
 * drawings, each harvested where it is read.
 */
import { createHash } from 'node:crypto';
import type { JsxNode } from '@/lib/jsx';
import type { StoredMermaidImage } from '@/lib/story-runtime/contract';
import { mermaidImageKey } from '@/lib/story-ui/mermaid-source';
import { getDb } from '@/lib/db';
import { objectStore } from '@/lib/object-store';
import { MERMAID_RENDER_ENGINE, mermaidPrerenderable } from './engine';
import { mermaidCodesOf } from './codes';
import type { MermaidFaces } from './drawn';

export type MermaidSurface = 'document' | 'inline';
export const MERMAID_SURFACES: readonly MermaidSurface[] = ['document', 'inline'];
export const MERMAID_MODES = ['light', 'dark'] as const;
export type MermaidMode = (typeof MERMAID_MODES)[number];
const MODES = MERMAID_MODES;
type Mode = MermaidMode;

/** Where a stored drawing is served (app/assets/mermaid/[file]/route.ts). */
export const mermaidImagePath = (key: string): string => `/assets/mermaid/${key}.svg`;
export const MERMAID_IMAGE_FILE = /^([0-9a-f]{64})\.svg$/;
export const mermaidObjectKey = (key: string): string => `mermaid/${key}.svg`;

/** The reader's switch: serve without stored drawings (the engine draws, exactly as before). */
export const MERMAID_ENGINE_PARAM = 'mermaid';
/** The capture's colour override (`color=light|dark`), honoured only under a valid export key. */
export const CAPTURE_COLOR_PARAM = 'color';

/** Does this request ask for the engine (no stored drawings)? */
export function engineRequested(url: string | URL): boolean {
  return new URL(url).searchParams.get(MERMAID_ENGINE_PARAM) === 'engine';
}
/** The colour a CAPTURE asked to be rendered in; the caller has verified its export key. */
export function captureColor(url: string | URL): Mode | null {
  const value = new URL(url).searchParams.get(CAPTURE_COLOR_PARAM);
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * Content address: the engine, the mode, the palette key, the code — and the
 * drawing's own bytes. The first four say what it is a drawing OF; the bytes
 * make the address the drawing itself, so no page can plant bytes under an
 * address another document's drawing would resolve to. A harvest reads the
 * attributes it keys by from the page it loaded, which is an author's page:
 * whatever a page claims, it can only ever name its own bytes.
 */
export function mermaidContentKey(mode: Mode, palette: string, code: string, svg: string): string {
  return createHash('sha256').update([MERMAID_RENDER_ENGINE, mode, palette, code, createHash('sha256').update(comparableSvg(svg)).digest('hex')].join('\0')).digest('hex');
}

/**
 * A drawing as two loads of it compare: the one thing that differs is the
 * render id (`mx-mermaid-N`), which counts diagrams in page order and appears
 * only as the drawing's own element id and its stylesheet's scope. Two
 * drawings equal under this are the same picture wherever each sits on its
 * page (kinds whose geometry reads the id are excluded, lib/mermaid-images/engine).
 */
export function comparableSvg(svg: string): string {
  return svg.replace(/mx-mermaid-\d+/g, 'mx-mermaid-N');
}

/**
 * A stored drawing's record. `faces` are the faces it carries (./fonts); a
 * record without them was stored by an engine before drawings carried their
 * fonts, and is never served (the engine string moved with it anyway).
 */
export interface MermaidImageInfo { type: string; width?: number; height?: number; mode: Mode; palette: string; faces?: MermaidFaces }
export type MermaidHarvestMap = Partial<Record<MermaidSurface, Record<string, string>>>;

/**
 * Would a write of this row leave something to harvest? A cheap look at the
 * markup. Never a PRIVATE document: a stored drawing is served by its address
 * alone, to anyone holding it, for as long as it is stored — which is the
 * posture of a public or link-shared document, not of one only its owner and
 * named people may read.
 */
function mayDrawMermaid(row: { format: string; visibility?: string | null; source?: string | null; document?: unknown }): boolean {
  if (row.format !== 'markup' || row.visibility === 'private') return false;
  const text = row.source ?? (row.document ? JSON.stringify(row.document) : '');
  return text.includes('Mermaid');
}

/** Insert the job (idempotent) and wake this process's harvester, if one runs. */
async function insertHarvest(artifactId: string, version: number): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO mermaid_harvests(artifact_id,version,engine) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [artifactId, version, MERMAID_RENDER_ENGINE]);
  wake?.();
}

/**
 * Queue a harvest of this version. After a commit, NEVER inside a transaction
 * (PGLite serialises one connection), and never failing its caller: callers
 * write `void queueMermaidHarvest(row)`.
 */
export async function queueMermaidHarvest(row: { id: string; version: number; format: string; visibility?: string | null; source?: string | null; document?: unknown }): Promise<void> {
  try {
    if (mayDrawMermaid(row)) await insertHarvest(row.id, row.version);
  } catch (error) {
    console.warn('[mermaid] could not queue a harvest:', (error as Error).message);
  }
}

/**
 * THE BACKFILL (scripts/mermaid-backfill.ts): queue a harvest for every live
 * document head that may draw a `<Mermaid>` and has no harvest for the current
 * engine yet — newest first, at most `limit` — and, with `retryFailed`, give
 * failed harvests their attempts back. Idempotent: run it twice and the second
 * run queues nothing new. It only QUEUES; the running app's harvester drains
 * the queue one version at a time, and readers queue what they read anyway.
 */
export async function queueMermaidBackfill(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, options: { limit?: number; retryFailed?: boolean; dryRun?: boolean } = {}): Promise<{ queued: number; retried: number }> {
  const candidates = `FROM artifacts a WHERE a.format='markup' AND a.deleted_at IS NULL AND a.visibility <> 'private'
    AND (a.source LIKE '%Mermaid%' OR (a.source IS NULL AND a.document::text LIKE '%Mermaid%'))
    AND NOT EXISTS (SELECT 1 FROM mermaid_harvests h WHERE h.artifact_id=a.id AND h.version=a.version AND h.engine=$1)`;
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 100_000));
  if (options.dryRun) {
    const queued = Number(((await db.query(`SELECT count(*) AS n FROM (SELECT 1 ${candidates} LIMIT $2) c`, [MERMAID_RENDER_ENGINE, limit])).rows[0] as { n: string }).n);
    const retried = options.retryFailed ? Number(((await db.query("SELECT count(*) AS n FROM mermaid_harvests WHERE state='failed' AND engine=$1", [MERMAID_RENDER_ENGINE])).rows[0] as { n: string }).n) : 0;
    return { queued, retried };
  }
  const queued = (await db.query(`INSERT INTO mermaid_harvests(artifact_id,version,engine)
    SELECT a.id,a.version,$1 ${candidates} ORDER BY a.updated_at DESC LIMIT $2 ON CONFLICT DO NOTHING RETURNING artifact_id`, [MERMAID_RENDER_ENGINE, limit])).rows.length;
  const retried = options.retryFailed ? (await db.query(`UPDATE mermaid_harvests SET state='pending',attempts=0,retry_after=NULL,updated_at=now()
    WHERE state='failed' AND engine=$1 RETURNING artifact_id`, [MERMAID_RENDER_ENGINE])).rows.length : 0;
  if (queued || retried) wake?.();
  return { queued, retried };
}

/** The running harvester's wake-up (lib/mermaid-images/harvester), when this process runs one. */
let wake: (() => void) | null = null;
export function onMermaidHarvestQueued(listener: (() => void) | null): void { wake = listener; }

/**
 * The stored drawings one version of a document has on one surface, keyed by
 * `mermaidImageKey(code, mode)` for every code it draws and both modes. Empty
 * when it has none yet — and a HEAD with no harvest row queues one, so the next
 * reader is served drawings. Never throws: a reader always gets a document.
 */
/** Which version, on which surface — and whether it is the head (only a head queues itself) and private (never served). */
export interface MermaidImageLookup { artifactId: string; version: number; surface: MermaidSurface; head: boolean; visibility: string }
export async function mermaidImagesFor(
  lookup: MermaidImageLookup,
  nodes: readonly JsxNode[],
): Promise<Record<string, StoredMermaidImage>> {
  if (lookup.visibility === 'private') return {};
  const codes = mermaidCodesOf(nodes).filter(mermaidPrerenderable);
  if (!codes.length) return {};
  try {
    const db = await getDb();
    const harvest = (await db.query<{ state: string; images: MermaidHarvestMap | null }>(
      'SELECT state,images FROM mermaid_harvests WHERE artifact_id=$1 AND version=$2 AND engine=$3',
      [lookup.artifactId, lookup.version, MERMAID_RENDER_ENGINE],
    )).rows[0];
    if (!harvest) {
      if (lookup.head) void insertHarvest(lookup.artifactId, lookup.version).catch(() => {});
      return {};
    }
    const map = harvest.state === 'done' ? harvest.images?.[lookup.surface] ?? {} : {};
    const wanted = new Map<string, string>();
    for (const code of codes) for (const mode of MODES) {
      const imageKey = mermaidImageKey(code, mode);
      const content = map[imageKey];
      if (typeof content === 'string' && /^[0-9a-f]{64}$/.test(content)) wanted.set(content, imageKey);
    }
    if (!wanted.size) return {};
    const rows = (await db.query<{ key: string; info: MermaidImageInfo }>(
      'SELECT key,info FROM mermaid_images WHERE key=ANY($1::text[]) AND engine=$2', [[...wanted.keys()], MERMAID_RENDER_ENGINE],
    )).rows;
    const images: Record<string, StoredMermaidImage> = {};
    for (const row of rows) {
      const imageKey = wanted.get(row.key);
      // Only a drawing that carries its fonts (./fonts): nothing of it is the reader's to resolve.
      if (!imageKey || !row.info.faces) continue;
      images[imageKey] = {
        src: mermaidImagePath(row.key), type: row.info.type, palette: row.info.palette,
        ...(typeof row.info.width === 'number' ? { width: row.info.width } : {}),
        ...(typeof row.info.height === 'number' ? { height: row.info.height } : {}),
      };
    }
    return images;
  } catch (error) {
    console.warn('[mermaid] stored drawings unavailable:', (error as Error).message);
    return {};
  }
}

/** A stored drawing's bytes, for app/assets/mermaid/[file]; null when there is none. */
export async function mermaidImageBytes(key: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  const db = await getDb();
  const row = (await db.query<{ object_key: string }>('SELECT object_key FROM mermaid_images WHERE key=$1', [key])).rows[0];
  if (!row) return null;
  try { return await objectStore().get(row.object_key); } catch { return null; }
}

