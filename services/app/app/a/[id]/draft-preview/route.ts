/** Ephemeral server compile for an editor's unsaved source. */
import { getArtifactById, dataflowForRow, declarationsForRow, refDataForRow } from '@/lib/artifacts';
import { readUrlValues } from '@/lib/story/data';
import { compileStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { json, readJson } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { canEdit } from '@/lib/share-roles';
import { compileDraft, draftCompileGate } from '@/lib/story/prepared/draft-compile.server';
import { requestOrSessionActor, roleFor } from '@/lib/viewer';
import { refusesCrossSite } from '@/lib/auth';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { STORY_THEME_NAMES } from '@/lib/validation/story-theme-names';
import { collectExternalAssetUrls } from '@/lib/story/assets';
import { lookupWebAssets } from '@/lib/web-assets';
import { collectRefUses } from '@/lib/story/data';

const MAX_SOURCE_LENGTH = 1024 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, NO_STORE);
  const artifact = await getArtifactById(id);
  if (!artifact || artifact.format !== 'markup') return json({ error: 'not_found' }, 404, NO_STORE);
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403, NO_STORE);
  if (!canEdit(await roleFor(artifact, actor))) return json({ error: 'not_found' }, 404, NO_STORE);
  const body = await readJson(request);
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
  // One running and one waiting compile per editor session; a newer draft answers older ones at once.
  const session = `${artifact.id}:${actor.viewer?.userId ?? actor.tokenId ?? ''}`;
  const compile = async (): Promise<string> => {
    const [compiledCss, dataflow, refData, assetUrls] = await Promise.all([
      compileStoryCss(body.source, { force: true }),
      dataflowForRow(draft, { ...(values ? { values } : {}), viewer: { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: actor.viewer?.email ?? null } }),
      refDataForRow(draft),
      lookupWebAssets(collectExternalAssetUrls(body.source).all),
    ]);
    return compileDraft({
      source: body.source,
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
    const result = await draftCompileGate().run(session, compile);
    if (!result.ok) {
      return result.reason === 'superseded'
        ? json({ error: 'superseded' }, 409, NO_STORE)
        : json({ error: 'draft_compile_busy' }, 429, { ...NO_STORE, 'Retry-After': '2' });
    }
    return json({ html: result.value }, 200, { ...NO_STORE, 'X-Content-Type-Options': 'nosniff' });
  } catch (error) {
    if (error instanceof Error && error.message === 'draft source is incomplete') return json({ error: 'invalid_draft' }, 422, NO_STORE);
    throw error;
  }
}
