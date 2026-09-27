import { publicCatalogOf } from '@/lib/datasets/catalog';
/**
 * The owner/editor SHELL's props for one document — everything ArtifactDocument
 * used to compute on the server: the ACL (uniform 404), the exporter's signed
 * key, the canonical address (the client heals to it), the viewer's role and
 * session kind, and ArtifactSurface's props (the prepared reader runtime, the
 * design, the declared dataflow, the open-annotation count).
 *
 * ONE answer for both doors: the JSON route (client navigation,
 * app/api/page/artifact/[id]) and the app page (server/app), which also
 * inlines the story this answer's runtime renders — without round-tripping
 * that render through the JSON.
 *
 * A DOCUMENT is served from its prepared page (lib/story/prepared-page.server):
 * the reader payload carries no source, no document graph and no raw
 * stylesheet. An owner or editor fetches those on the EDITOR door
 * (`?part=editor`) — prefetched on idle, so entering edit mode stays instant.
 */
import { archivedVersionFor, servedRow } from '@/lib/archived-version';
import { countOpenAnnotations } from '@/lib/annotations';
import { canReadArtifact, getArtifactFor, getArtifactById } from '@/lib/artifacts';
import { folderPageFor } from '@/lib/folders';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { verifyExportKey } from '@/lib/export-key';
import { baseUrl, json } from '@/lib/http';
import { forkedFromCredit } from '@/lib/story/fork-credit.server';
import { ID_RE } from '@/lib/ids';
import { count, has } from '@/lib/relations';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { ARTIFACT_FORMATS, type ArtifactFormat } from '@/lib/story/input';
import { canonicalArtifactPath } from '@/lib/urls';
import { getUserById, ownerUsername } from '@/lib/users';
import { avatarUrl } from '@/lib/avatars';
import { actorForArtifacts, browserSessionKind, roleFor, sessionActor } from '@/lib/viewer';
import { accountWorkspaceFor } from '@/lib/workspace';
import { canAnnotate, canEdit } from '@/lib/share-roles';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { preparedPageFor, servedPage } from '@/lib/story/prepared-page.server';
import { captureColor, engineRequested } from '@/lib/mermaid-images/store';
import { lazyCodeOf } from '@/lib/story/lazy-code';
import { firstHeadingTitle } from '@/lib/story/title';
import { isStartPlaceholder } from '@/lib/start-placeholder';
import type { LazyCode } from '@/lib/story/lazy-code';

/** The story the app page inlines for this answer (server/app withInitialStory). */
export interface InitialStory {
  /** The story element, rendered (or the stored anonymous render, when this request's overlay is the same). */
  html: () => string;
  title: string;
  fontPreloads: string[];
  lazyCode: LazyCode;
  starter: boolean;
  /**
   * The served story is FINAL for this viewer: a static document
   * (lib/story/prepared-page.server `static`) read by someone who may neither
   * edit nor comment on it, outside a capture. The page names no story
   * runtime, and the reader does not load one unless the viewer comes to need
   * it (components/ArtifactSurface).
   */
  final: boolean;
}

export interface ArtifactPageAnswer {
  status: number;
  body: unknown;
  story?: InitialStory;
}

const notFound = (): ArtifactPageAnswer => ({ status: 404, body: { error: 'not_found' } });

export async function artifactPageAnswer(request: Request, id: string): Promise<ArtifactPageAnswer> {
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
    return { status: 200, body: {
      canonical: canonicalArtifactPath(artifact, handle),
      ownerUsername: handle,
      role,
      kind,
      // The TOKEN travels beside the account, as everywhere the folder ACL is
      // asked: an unclaimed folder is owned by the token that made it, and the
      // account viewer alone would answer its own owner a stranger's shelf.
      folder,
      ...(workspace ? { workspace } : {}),
    } };
  }

  /*
   * `?version=N` — the page renders THAT version, read-only, for whoever may
   * read the artifact's history. One decision with the served document's
   * (lib/archived-version), so `/a/<id>?version=2` and `/a/<id>/raw?version=2`
   * can never disagree about who may see it or about what it resolves to; a
   * refusal is this route's own uniform 404, so a reader without history access
   * does not learn the parameter exists.
   */
  const at = await archivedVersionFor(request, artifact, { capture: exporting });
  if (at === 'not_found') return notFound();
  const isDoc = artifact.format === 'markup';

  /*
   * THE EDITOR'S DOOR: what only writing needs — the source, the document
   * graph and the raw sheets the in-place editor re-isolates as it types.
   * The reader payload below carries none of it; a writer's page prefetches
   * this on idle (components/ArtifactSurface).
   */
  if (search.get('part') === 'editor') {
    if (!isDoc || at || exporting || !canEdit(role)) return notFound();
    const { row, page } = await preparedPageFor(artifact, null, baseUrl(request));
    return { status: 200, body: {
      editId: artifact.edit_id, version: artifact.version, source: row.source ?? '',
      ...(artifact.document?.kind === 'graph' ? { document: artifact.document } : {}),
      compiledCss: await currentStoryCss((row.meta ?? {}) as { compiledCss?: string | null; cssCompileVersion?: string | null }, row.source),
      authorCss: page.authorCss,
    } };
  }

  // Everything below reads THIS row: the artifact wearing that version's bytes
  // when one was asked for, the artifact itself otherwise. A document's comes
  // with its prepared page (lib/story/prepared-page.server) — a stored entry on
  // a hit, a compile on a miss — while the reads that need neither run beside it.
  const viewerId = actor.viewer?.userId ?? null;
  // Independent reads begin only after ACL admission. These values belong to
  // this request; no identity or permission answer is retained across requests.
  const social = Promise.all([
    // The author's row, once: the handle (byline, canonical) and their face.
    artifact.user_id ? getUserById(artifact.user_id) : Promise.resolve(null), forkedFromCredit(artifact.forked_from),
    // The heart renders from THIS answer: asking a second door for it would
    // leave the control blank (or wrong) for a frame on every page load. An
    // anonymous reader still gets the count — it is the number, not the button,
    // that everyone can see.
    viewerId ? has(viewerId, 'like', artifact.id) : Promise.resolve(false),
    count('like', artifact.id),
    artifact.user_id && artifact.user_id !== viewerId && viewerId ? has(viewerId, 'follow', artifact.user_id) : Promise.resolve(false),
    artifact.user_id && artifact.user_id !== viewerId ? count('follow', artifact.user_id) : Promise.resolve(0),
    canAnnotate(role) && isDoc ? countOpenAnnotations(artifact.id) : Promise.resolve(0),
    artifact.format === 'dataset' ? loadDatasetRows(artifact).then(rows => JSON.stringify(rows)) : Promise.resolve(isDoc ? '' : (artifact.format === 'viz' ? artifact.source ?? '' : '')),
  ] as const);
  // Awaited below; a failure of the preparation first must not leave this one unobserved.
  void social.catch(() => {});
  const prepared = isDoc ? await preparedPageFor(artifact, at, baseUrl(request)) : null;
  const row = prepared?.row ?? await servedRow(artifact, at);

  const meta = (row.meta ?? {}) as {
    theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  // A CAPTURE may be drawn in either mode (lib/mermaid-images harvests both); a reader sees the author's.
  const capturedColor = exporting ? captureColor(request.url) : null;
  const design = resolveStoredStoryDesign(meta.theme, capturedColor ?? meta.colorMode);
  // A document's sheet is its prepared page's; the data tiers keep their stored one.
  const compiledCss = isDoc ? null : meta.compiledCss ?? null;
  const [served, [author, forkedFrom, liked, likeCount, following, followCount, openAnnotations, dataPreview]] = await Promise.all([
    // What only this request decides, over the stored version.
    prepared ? servedPage(prepared.row, prepared.page, {
      at, search: new URL(request.url).search, origin: baseUrl(request),
      // This version's stored diagram drawings, unless the engine was asked for by name (`?mermaid=engine`).
      drawings: engineRequested(request.url) ? 'engine' : 'stored',
      colorMode: capturedColor,
      viewer: { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: actor.viewer?.email ?? null },
    }) : Promise.resolve(null),
    social,
  ]);
  const authorUsername = author?.username ?? null;
  const ownerScope = role === 'owner' ? actorForArtifacts(actor) : null;
  const hasInvitedUsers = ownerScope ? ((await getArtifactFor(ownerScope, id))?.shares?.length ?? 0) > 0 : false;
  const starter = isDoc && isStartPlaceholder(row.source ?? null, artifact.version);
  const surface = {
    captureKey: exporting ? key : null,
    id: artifact.id,
    editId: artifact.edit_id,
    format: artifact.format,
    visibility: artifact.visibility,
    ...(ownerScope ? { hasInvitedUsers } : {}),
    title: row.title,
    author: { username: authorUsername, id: author?.id ?? null, image: author ? avatarUrl(author) : null, forkedFrom },
    ...(served ? {
      runtime: served.runtime,
      // What the reader's chrome derived from the source: the document's own
      // name (lib/story/title) and whether it is still the starter placeholder.
      heading: firstHeadingTitle(row.source), starter,
    } : {
      // The data tiers: their source is their content (a dataset's only for those who may edit it).
      source: artifact.format==='dataset'&&role!=='owner'&&role!=='editor'?null:row.source,
      compiledCss,
      // What a writer's editor needs to open without a round trip, for non-document formats.
      ...(row.document?.kind==='graph'?{document:row.document}:{}),
    }),
    dataPreview,
    columns: meta.columns ?? [],
    ...(artifact.format==='dataset' && (artifact.meta as Record<string,unknown>).catalog ? {catalog:publicCatalogOf(artifact)!}:{}),
    // A stored FILE is not a document the app can render, so its view is the
    // two facts a person picks a file by plus the link that opens it.
    ...(artifact.format === 'pdf' || artifact.format === 'file' ? { bytes: (meta as { bytes?: number }).bytes ?? 0, pages: (meta as { pages?: number }).pages ?? null } : {}),
    theme: design.theme,
    colorMode: design.colorMode,
    template: meta.template ?? null,
    // Ids only: the data view that names a dataset is EDIT-only, and it
    // loads through /api/my/artifacts/:id where the join happens. A reader
    // never sees a ref's title, so nobody's page pays for the lookups.
    refs: meta.refs ?? [],
    accountSession: kind === 'account',
    anonSession: kind === 'anon',
    version: artifact.version,
    // Anyone who may COMMENT has a comment badge to fill: computing this
    // for the owner alone left an editor's and a commenter's count at 0
    // forever, on a control they were being shown.
    openAnnotations,
  };
  const body = {
    canonical: canonicalArtifactPath(artifact, authorUsername),
    description: row.description,
    role,
    kind,
    /*
     * WHICH VERSION THIS IS, beside `surface` rather than inside it — the
     * surface's own props are what the DOCUMENT is, and this is what the RENDER
     * is: the page draws the banner from it and shuts edit, comment, like, fork
     * and share on it. Absent entirely for the head, so no page that did not
     * ask for a version can accidentally read one.
     */
    ...(at ? { archived: { version: at.version, head: at.head } } : {}),
    like: { liked, count: likeCount },
    // The follow control is keyed by the AUTHOR's id. Null for an anonymous
    // document, and for the owner, who has nobody here to follow.
    follow: artifact.user_id && artifact.user_id !== viewerId
      ? { userId: artifact.user_id, following, count: followCount }
      : null,
    // A document's runtime carries its sheet once, isolated; the data tiers carry their stored one.
    surface,
  };
  return {
    status: 200, body,
    ...(served && prepared ? { story: {
      html: served.storyHtml, title: served.runtime.title, fontPreloads: served.runtime.fontPreloads ?? [],
      // A diagram drawn from its stored SVG runs no engine: its kind's code is not preloaded.
      lazyCode: served.runtime.data.mermaidImages
        ? lazyCodeOf(prepared.page.data.nodes, { images: served.runtime.data.mermaidImages, mode: served.runtime.data.colorMode })
        : prepared.page.lazyCode,
      starter,
      final: prepared.page.static && !starter && !exporting && !canEdit(role) && !canAnnotate(role),
    } } : {}),
  };
}

/** The JSON door (app/api/page/artifact/[id]). */
export async function artifactPageResponse(request: Request, id: string): Promise<Response> {
  const answer = await artifactPageAnswer(request, id);
  return answer.status === 200 ? json(answer.body, 200, { 'Cache-Control': 'no-store' }) : json(answer.body, answer.status);
}
