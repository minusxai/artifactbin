import { publicCatalogOf } from '@/lib/datasets/catalog';
import { compactSurface } from '@/lib/story/page-transport';
/**
 * The owner/editor SHELL's props for one document — everything ArtifactDocument
 * used to compute on the server: the ACL (uniform 404), the exporter's signed
 * key, the canonical address (the client heals to it), the viewer's role and
 * session kind, and ArtifactSurface's props (compiled CSS, design, the
 * server-run dataflow, the open-annotation count).
 */
import { countOpenAnnotations } from '@/lib/annotations';
import { canReadArtifact, declarationsForRow, getArtifactById, refDataForRow } from '@/lib/artifacts';
import { folderPageFor } from '@/lib/folders';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { verifyExportKey } from '@/lib/export-key';
import { baseUrl, json } from '@/lib/http';
import { ASSETS_ORIGIN } from '@/lib/config';
import { prepareStoryRuntime } from '@/lib/story/prepare-runtime.server';
import { forkedFromCredit } from '@/lib/story/fork-credit.server';
import { webAssetsForSource } from '@/lib/web-assets';
import { assetsPath, mutatePath, queryPath } from '@/lib/story/markup-csp';
import { readUrlValues } from '@/lib/story/url-values';
import { ID_RE } from '@/lib/ids';
import { count, has } from '@/lib/relations';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { ARTIFACT_FORMATS, type ArtifactFormat } from '@/lib/story/input';
import { canonicalArtifactPath } from '@/lib/urls';
import { ownerUsername } from '@/lib/users';
import { browserSessionKind, roleFor, sessionActor } from '@/lib/viewer';
import { accountWorkspaceFor } from '@/lib/workspace';
import { canAnnotate } from '@/lib/share-roles';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const notFound = () => json({ error: 'not_found' }, 404);
  if (!ID_RE.test(id)) return notFound();
  const artifact = await getArtifactById(id);
  if (!artifact) return notFound();
  const search = new URL(request.url).searchParams;
  const key = search.get('key');
  const exporting = verifyExportKey(artifact.id, key ?? undefined);
  const actor = await sessionActor(request);
  if (!exporting && !(await canReadArtifact(artifact, actor.viewer))) return notFound();
  if (!ARTIFACT_FORMATS.includes(artifact.format as ArtifactFormat)) return notFound();

  const role = await roleFor(artifact, actor);
  const kind = await browserSessionKind(request, actor);

  /*
   * A FOLDER IS A LISTING, NOT A DOCUMENT — so its page is answered HERE and
   * carries no `surface` at all.
   *
   * Measured on production while a folder was a document: shell HTML 0.25 s,
   * the frame's document 0.98 s, the sandboxed runtime booted 2.59 s, the
   * children query answered 2.86 s — with the server idle for all of it (the
   * query is ~50 ms). The listing was last because it was authored markup
   * inside an opaque origin that cannot cache the runtime it needed. It is app
   * data now: computed once here, inlined into the HTML by `withBootstrap`, so
   * the rows are in the first byte and the first paint is the final geometry.
   *
   * Above every `isDoc` branch below, because none of them applies: there is no
   * source to compile a sheet for, no declarations to seed, no annotations to
   * count and nothing to frame.
   */
  if (artifact.format === 'folder') {
    const handle = await ownerUsername(artifact.user_id);
    const [folder, workspace] = await Promise.all([
      folderPageFor(artifact, { userId: actor.viewer?.userId ?? null, email: actor.viewer?.email ?? null, tokenId: actor.tokenId ?? null }),
      role === 'owner' && actor.viewer?.userId
        ? accountWorkspaceFor(actor.viewer.userId, actor.viewer.email)
        : Promise.resolve(null),
    ]);
    return json({
      canonical: canonicalArtifactPath(artifact, handle),
      ownerUsername: handle,
      role,
      kind,
      // The TOKEN travels beside the account, as everywhere the folder ACL is
      // asked: an unclaimed folder is owned by the token that made it, and the
      // account viewer alone would answer its own owner a stranger's shelf.
      folder,
      ...(workspace ? { workspace } : {}),
    }, 200, { 'Cache-Control': 'no-store' });
  }

  const meta = (artifact.meta ?? {}) as {
    theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const isDoc = artifact.format === 'markup';
  // The heart renders from THIS answer: asking a second door for it would
  // leave the control blank (or wrong) for a frame on every page load. An
  // anonymous reader still gets the count — it is the number, not the button,
  // that everyone can see.
  const viewerId = actor.viewer?.userId ?? null;
  // Independent reads begin only after ACL admission. These values belong to
  // this request; no identity or permission answer is retained across requests.
  const [authorUsername, forkedFrom, compiledCss, refData, assetUrls, liked, likeCount, following, followCount, openAnnotations, content] = await Promise.all([
    ownerUsername(artifact.user_id), forkedFromCredit(artifact.forked_from),
    isDoc ? currentStoryCss(meta, artifact.source) : Promise.resolve(meta.compiledCss ?? null),
    isDoc ? refDataForRow(artifact) : Promise.resolve({}),
    isDoc ? webAssetsForSource(artifact.source) : Promise.resolve(undefined),
    viewerId ? has(viewerId, 'like', artifact.id) : Promise.resolve(false),
    count('like', artifact.id),
    artifact.user_id && artifact.user_id !== viewerId && viewerId ? has(viewerId, 'follow', artifact.user_id) : Promise.resolve(false),
    artifact.user_id && artifact.user_id !== viewerId ? count('follow', artifact.user_id) : Promise.resolve(0),
    canAnnotate(role) && isDoc ? countOpenAnnotations(artifact.id) : Promise.resolve(0),
    artifact.format === 'dataset' ? loadDatasetRows(artifact).then(rows => JSON.stringify(rows)) : Promise.resolve(isDoc ? '' : artifact.content),
  ]);
  const declared = isDoc && artifact.source ? declarationsForRow(artifact) : null;
  const dataflow = declared ? { ...declared, values: readUrlValues(new URL(request.url).search, declared.flow) } : null;
  const runtime = isDoc ? await prepareStoryRuntime({
    source: artifact.source ?? '', compiledCss, theme: design.theme,
    colorMode: design.colorMode, title: artifact.title, template: meta.template ?? null,
    refData, assetUrls, dataflow,
    queryUrl: queryPath(artifact.id), assetsUrl: assetsPath(artifact.id),
    ...(declared?.flow.mutations?.length ? { mutateUrl: mutatePath(artifact.id) } : {}),
    ...(ASSETS_ORIGIN ? { managedAssets: { origin: ASSETS_ORIGIN, resolveUrl: `${baseUrl(request)}${assetsPath(artifact.id)}` } } : {}),
  }) : undefined;
  return json({
    canonical: canonicalArtifactPath(artifact, authorUsername),
    description: artifact.description,
    role,
    kind,
    like: { liked, count: likeCount },
    // The follow control is keyed by the AUTHOR's id. Null for an anonymous
    // document, and for the owner, who has nobody here to follow.
    follow: artifact.user_id && artifact.user_id !== viewerId
      ? { userId: artifact.user_id, following, count: followCount }
      : null,
    surface: compactSurface({
      captureKey: exporting ? key : null,
      id: artifact.id,
      editId: artifact.edit_id,
      format: artifact.format,
      title: artifact.title,
      author: { username: authorUsername, forkedFrom },
      ...(runtime ? { runtime } : {}),
      source: artifact.format==='dataset'&&role!=='owner'&&role!=='editor'?null:artifact.source,
      content,
      columns: meta.columns ?? [],
      ...(artifact.format==='dataset' && (artifact.meta as Record<string,unknown>).catalog ? {catalog:publicCatalogOf(artifact)!}:{}),
      // A stored FILE is not a document the app can render, so its view is the
      // two facts a person picks a file by plus the link that opens it.
      ...(artifact.format === 'pdf' || artifact.format === 'file' ? { bytes: (meta as { bytes?: number }).bytes ?? 0, pages: (meta as { pages?: number }).pages ?? null } : {}),
      compiledCss,
      theme: design.theme,
      colorMode: design.colorMode,
      template: meta.template ?? null,
      refs: meta.refs ?? [],
      // Paint first: the DECLARATIONS, not the rows. The page's copy exists to
      // seed the editor, and the editor runs a draft's queries itself — so
      // running them here only held the owner's own page behind the SQL, with
      // the results inlined into its HTML (withBootstrap).
      dataflow,
      accountSession: kind === 'account',
      anonSession: kind === 'anon',
      version: artifact.version,
      // Anyone who may COMMENT has a comment badge to fill: computing this
      // for the owner alone left an editor's and a commenter's count at 0
      // forever, on a control they were being shown.
      openAnnotations,
    }),
  }, 200, { 'Cache-Control': 'no-store' });
}
