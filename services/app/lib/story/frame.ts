/**
 * THE LIVE FRAME — stateless and complete.
 *
 * One frame per (id, edit_id): the parsed body, the compiled stylesheet
 * (ALWAYS — nothing is "omitted since last time", because there is no last
 * time), the author's own CSS, the design, the declarations' SIGNATURE and
 * their FLOW — and never the dataflow's rows. A client that sees the signature
 * move re-runs its queries through the transport it already holds; a client
 * that sees it unchanged keeps what it has. That is what lets the stream
 * carry pings only, and lets a relay blind to content deliver them.
 *
 * Cached by (id, edit_id): a document with two hundred readers costs one
 * build per version, not two hundred (it used to be built per connection).
 */
import type { ArtifactRow } from '@/lib/artifacts';
import { dataflowForRow, datasetsForDocument } from '@/lib/artifacts';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { authorHandle } from '@/lib/users';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { loadDatasetRows } from './dataset-store';
import type { ArtifactLiveEvent } from './live';
import { storyUpdateParts } from './update-parts';

export interface LiveFrame extends Omit<ArtifactLiveEvent, 'compiledCss' | 'authorCss' | 'dataflow'> {
  compiledCss: string | null;
  authorCss: string | null;
  /** A stable signature of the data declarations; the client rebinds when it moves. */
  declarations: string | null;
  /** The declarations as a flow, rows deliberately absent (the client re-runs). */
  dataflow?: { flow: NonNullable<ReturnType<typeof storyUpdateParts>>['flow'] };
  /** The datasets this version reads or writes — what a relay must also follow. */
  datasets: string[];
}

const CACHE_MAX = 64;
const cache = new Map<string, Promise<LiveFrame>>();
let builds = 0;

/** Test hooks. */
export function resetFrameCache(): void { cache.clear(); }
export function frameBuilds(): number { return builds; }

async function build(row: ArtifactRow): Promise<LiveFrame> {
  builds++;
  const meta = row.meta as {
    compiledCss?: string | null; theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null;
    template?: string | null; cssCompileVersion?: string | null;
  };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const css = row.format === 'markup' ? await currentStoryCss(meta, row.source) : meta.compiledCss ?? null;
  const parts = row.format === 'markup' && row.source ? storyUpdateParts(row.source) : null;
  return {
    editId: row.edit_id,
    version: row.version,
    by: await authorHandle(row),
    format: row.format,
    title: row.title,
    source: row.format === 'markup' ? row.source : null,
    content:
      row.format === 'dataset' ? JSON.stringify(await loadDatasetRows(row))
      : row.format === 'viz' ? row.content
      : null,
    compiledCss: css,
    authorCss: parts?.authorCss ?? null,
    ...(parts ? { nodes: parts.nodes } : {}),
    declarations: parts?.declarations ?? null,
    ...(parts && parts.flow.queries.length + parts.flow.values.length > 0 ? { dataflow: { flow: parts.flow } } : {}),
    datasets: row.format === 'markup' ? datasetsForDocument(row.source) : [],
    theme: design.theme,
    colorMode: design.colorMode,
    template: meta.template ?? null,
  };
}

/** The frame for this row, built at most once per (id, edit_id). */
export function liveFrameFor(row: ArtifactRow): Promise<LiveFrame> {
  const key = `${row.id}:${row.edit_id}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = build(row).catch((error) => { cache.delete(key); throw error; });
    cache.set(key, hit);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

/** Kept importable for callers that still want the SERVER-run state (the page's island). */
