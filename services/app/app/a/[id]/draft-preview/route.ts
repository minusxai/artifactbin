/** Ephemeral server compile for an editor's unsaved source. */
import { getArtifactById, dataflowForRow, declarationsForRow, refDataForRow } from '@/lib/artifacts';
import { readUrlValues } from '@/lib/story/data';
import { compileStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { json, readJson } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { canEdit } from '@/lib/artifacts';
import { compileDraft, draftCompileGate } from '@/lib/story/prepared/draft-compile.server';
import { requestOrSessionActor, roleFor } from '@/lib/accounts';
import { refusesCrossSite } from '@/lib/accounts';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { STORY_THEME_NAMES } from '@/lib/validation/story-theme-names';
import { collectExternalAssetUrls } from '@/lib/story/assets';
import { lookupWebAssets } from '@/lib/serving';
import { createHash } from 'node:crypto';
import { collectRefUses } from '@/lib/story/data';
import { prepareStoryParts } from '@/lib/story/prepared/prepare-runtime.server';
import { inlineStoryCss } from '@/lib/story/styles/inline-css';

const MAX_SOURCE_LENGTH = 1024 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The editor names its drafts' order in `X-Draft-Sequence: <editor session>.<n>` (n rising per draft).
 * Drafts so named supersede within their session — this document, this credential, that editor — and
 * only by that order: the order requests ARRIVE in is not the order they were sent (parallel
 * connections), and superseding by it can drop the newest draft. An unnamed draft is its own session,
 * bounded only by the global cap, and may wait longer for a slot.
 */
const SEQUENCE_RE = /^([\w-]{1,64})\.(\d{1,15})$/;
const UNORDERED_WAIT_MS = 20_000;
let unordered = 0;
function draftTicket(request: Request, gate: ReturnType<typeof draftCompileGate>) {
  const named = SEQUENCE_RE.exec(request.headers.get('x-draft-sequence') ?? '');
  if (!named) return gate.arrive(`unordered:${++unordered}`, 1, UNORDERED_WAIT_MS);
  const credential = request.headers.get('authorization') ?? request.headers.get('cookie') ?? '';
  const session = `${new URL(request.url).pathname}:${createHash('sha256').update(credential).digest('base64url')}:${named[1]}`;
  return gate.arrive(session, Number(named[2]));
}

/**
 * GET: the stylesheet a draft of the saved head compiles with — the whole sheet (every recipe and theme), where
 * the served page carries only the reader's cut (lib/story/prepared/reader-sheet.server). The editor writes it
 * once on entering edit mode, before typing, so the first compile reply swaps no sheet (a sheet swap restyles the
 * whole page, inside that reply's draw).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, NO_STORE);
  const artifact = await getArtifactById(id);
  if (!artifact || artifact.format !== 'markup') return json({ error: 'not_found' }, 404, NO_STORE);
  const actor = await requestOrSessionActor(request);
  if (!canEdit(await roleFor(artifact, actor))) return json({ error: 'not_found' }, 404, NO_STORE);
  const meta = (artifact.meta ?? {}) as { theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; template?: string | null };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const source = artifact.source ?? '';
  // As the POST below compiles a draft of this source: the same sheet, assets and design.
  const [compiledCss, assetUrls] = await Promise.all([
    compileStoryCss(source, { force: true }), lookupWebAssets(collectExternalAssetUrls(source).all),
  ]);
  const parts = await prepareStoryParts({
    source, compiledCss, theme: design.theme, colorMode: design.colorMode, title: artifact.title, template: meta.template ?? null,
    refData: {}, assetUrls,
  });
  return json({ css: inlineStoryCss(parts.runtime), version: artifact.version }, 200, NO_STORE);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  // The draft takes its place in its editor's session before anything is awaited (draft-compile-gate).
  const gate = draftCompileGate();
  const ticket = draftTicket(request, gate);
  // Overtaken while it waited for the thread: answered before its document and body are read and parsed.
  const SUPERSEDED = () => json({ error: 'superseded' }, 409, NO_STORE);
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, NO_STORE);
  if (gate.superseded(ticket)) return SUPERSEDED();
  const artifact = await getArtifactById(id);
  if (!artifact || artifact.format !== 'markup') return json({ error: 'not_found' }, 404, NO_STORE);
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403, NO_STORE);
  if (!canEdit(await roleFor(artifact, actor))) return json({ error: 'not_found' }, 404, NO_STORE);
  if (gate.superseded(ticket)) return SUPERSEDED();
  const body = await readJson(request);
  if (gate.superseded(ticket)) return SUPERSEDED();
  if (!body || typeof body.source !== 'string' || typeof body.editId !== 'string' || body.source.length > MAX_SOURCE_LENGTH) {
    return json({ error: 'invalid_draft' }, 400, NO_STORE);
  }
  // No head check: the preview writes nothing, and the editor's draft is ahead of the head it last saw
  // for as long as a save is in flight. Refusing the old `editId` blanked the preview on every such race.
  const meta = (artifact.meta ?? {}) as { theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; template?: string | null };
  const theme = body.theme === null || (typeof body.theme === 'string' && STORY_THEME_NAMES.includes(body.theme as StoryThemeName))
    ? body.theme as StoryThemeName | null : meta.theme;
  const colorMode = body.colorMode === 'light' || body.colorMode === 'dark' ? body.colorMode : meta.colorMode;
  const design = resolveStoredStoryDesign(theme, colorMode);
  // The source can introduce an uploaded image before the next save has written
  // its reference graph. Resolve only references the editor can actually read.
  const uses = collectRefUses(body.source);
  const refs = uses ? [...new Map(uses.map((use) => [use.id, { id: use.id, kind: use.kind }])).values()] : [];
  const draft = { ...artifact, source: body.source, meta: { ...(artifact.meta ?? {}), refs } };
  // Rendered at the editor's CURRENT values (its address carries them, as the reader's story fragment
  // does): the draft's islands hydrate against the running store, and hydration keeps the server's text.
  const search = typeof body.search === 'string' && body.search.length <= 8192 ? body.search : '';
  const declared = search ? await declarationsForRow(draft) : null;
  const values = declared?.flow ? readUrlValues(search, declared.flow) : undefined;
  const source: string = body.source;
  const compile = async (): Promise<string> => {
    const [compiledCss, dataflow, refData, assetUrls] = await Promise.all([
      compileStoryCss(source, { force: true }),
      dataflowForRow(draft, { ...(values ? { values } : {}), viewer: { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: actor.viewer?.email ?? null } }),
      refDataForRow(draft),
      lookupWebAssets(collectExternalAssetUrls(source).all),
    ]);
    return compileDraft({
      source: source,
      title: artifact.title,
      theme: design.theme,
      template: meta.template ?? null,
      colorMode: design.colorMode,
      compiledCss,
      dataflow,
      refData,
      assetUrls,
    });
  };
  try {
    const result = await gate.run(ticket, compile);
    if (!result.ok) {
      return result.reason === 'superseded'
        ? SUPERSEDED()
        : json({ error: 'draft_compile_busy' }, 429, { ...NO_STORE, 'Retry-After': '2' });
    }
    return json({ html: result.value }, 200, { ...NO_STORE, 'X-Content-Type-Options': 'nosniff' });
  } catch (error) {
    if (error instanceof Error && error.message === 'draft source is incomplete') return json({ error: 'invalid_draft' }, 422, NO_STORE);
    throw error;
  }
}
