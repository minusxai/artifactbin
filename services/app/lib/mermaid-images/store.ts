/** Durable Mermaid harvest jobs, content-addressed SVG records and asset reads.
 * Drawing validation and harvest admission share this storage boundary. */
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/platform/db';
import { objectStore } from '@/lib/object-store';
import { MERMAID_RENDER_ENGINE } from './engine';
import type { MermaidFaces } from './drawn';

export type MermaidSurface = 'document' | 'inline';
export const MERMAID_SURFACES: readonly MermaidSurface[] = ['document', 'inline'];
export const MERMAID_MODES = ['light', 'dark'] as const;
export type MermaidMode = (typeof MERMAID_MODES)[number];
type Mode = MermaidMode;

/** Where a stored drawing is served (app/assets/mermaid/[file]/route.ts). */
export const MERMAID_IMAGE_FILE = /^([0-9a-f]{64})\.svg$/;
export const mermaidObjectKey = (key: string): string => `mermaid/${key}.svg`;

/** The reader's switch: serve without stored drawings (the engine draws, exactly as before). */
export const MERMAID_ENGINE_PARAM = 'mermaid';
/** The capture's colour override (`color=light|dark`), honoured only under a valid export key. */
export const CAPTURE_COLOR_PARAM = 'color';

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

/** The running harvester's wake-up (lib/publish/assets/mermaid-harvester), when this process runs one. */
let wake: (() => void) | null = null;
export function onMermaidHarvestQueued(listener: (() => void) | null): void { wake = listener; }

/** A stored drawing's bytes, for app/assets/mermaid/[file]; null when there is none. */
export async function mermaidImageBytes(key: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  const db = await getDb();
  const row = (await db.query<{ object_key: string }>('SELECT object_key FROM mermaid_images WHERE key=$1', [key])).rows[0];
  if (!row) return null;
  try { return await objectStore().get(row.object_key); } catch { return null; }
}

