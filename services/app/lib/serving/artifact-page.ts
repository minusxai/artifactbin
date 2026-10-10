import { artifactPwaEnabled } from './artifact-pwa.server';
import { membershipState } from '@/lib/artifacts/membership/membership';
import { publicCatalogOf } from '@/lib/datasets/catalog';
/**
 * The owner/editor SHELL's props for one document — everything ArtifactDocument
 * used to compute on the server: the ACL (uniform 404), the exporter's signed
 * key, the canonical address (the client heals to it), the viewer's role and
 * session kind, and the artifact page's props (the prepared reader runtime, the
 * design, the declared dataflow, the open-annotation count).
 *
 * ONE answer for both doors: the JSON route (client navigation,
 * app/api/page/artifact/[id]) and the app page (server/app), which also draws
 * the document's frame — the document itself is only ever rendered on its own
 * origin (lib/http/pages-origin, app/a/[id]/raw), never inside the app page.
 *
 * A DOCUMENT is served from its prepared page (lib/publish/prepared/prepared-page.server):
 * the reader payload carries no source, no document graph and no raw
 * stylesheet. An owner or editor fetches those on the EDITOR door
 * (`?part=editor`) — prefetched on idle, so entering edit mode stays instant.
 */
import { archivedVersionFor, servedRow } from '@/lib/artifacts/archived-version';
import { UnservableDocument } from '@/lib/artifacts/servable';
import { countOpenAnnotations } from '@/lib/annotations/store';
import { canReadArtifact, roleFor } from '@/lib/artifacts/access';
import { getArtifactFor, getArtifactById } from '@/lib/artifacts/store';
import { folderPageFor } from '@/lib/workspace/folders';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { verifyExportKey } from '@/lib/platform/export-read-key';
import { baseUrl, json } from '@/lib/http/http';
import { forkedFromCredit } from './fork-credit.server';
import { ID_RE } from '@/lib/platform/ids';
import { count, has } from '@/lib/accounts/relations';
import { loadDatasetRows } from '@/lib/datasets/dataset-store';
import { ARTIFACT_FORMATS, type ArtifactFormat, canAnnotate, canEdit, CARD_RENDER_GENERATION, isStartPlaceholder } from '@artifactbin/contracts';
import { canonicalArtifactPath } from '@/lib/http/urls';
import { getUserById, ownerUsername } from '@/lib/accounts/users';
import { avatarUrl } from '@/lib/accounts/avatars';
import { actorForArtifacts, browserSessionKind, isBrowserSessionRequest, sessionActor } from '@/lib/accounts/viewer';
import { accountWorkspaceFor } from '@/lib/workspace/dashboard';
import type { StoryDesignName } from '@/lib/validation/atlas-schemas';
import { preparedPageFor, servedPage } from '@/lib/publish/prepared/prepared-page.server';
import { captureColor, engineRequested } from '@/lib/mermaid-images/store';
import { firstHeadingTitle } from '@/lib/document/head';
import type { ArtifactRow } from '@/lib/artifacts';
import { issuePagesTicket } from '@/lib/accounts/pages-sessions';
import { pagesOriginFor, pagesSessionUrl, type PagesSite } from '../http/pages-origin';
import { carriedTrust, cspRequestFor } from '@/lib/trust/document-trust';
import type { DocumentFrame } from './document-frame';

export interface ArtifactPageAnswer {
  status: number;
  body: unknown;
  /** The document's frame, which the app page draws (lib/serving/document-frame): only the HTML door asks for it. */
  frame?: DocumentFrame;
  /** Which renderer answered a document's page (the page's `x-mx-reader` header): the compiled page, in its frame. */
  reader?: { mode: 'compiled' };
}

/** What the app page (never the JSON door) hands the answer. */
interface ArtifactPageOptions {
  /**
   * The row the caller already fetched AND admitted for this very request (server/app
   * documentPreparation): the answer neither fetches it again nor decides admission again — one row
   * fetch and one access check per view.
   */
  admitted?: ArtifactRow;
  /**
   * The app page (the HTML door): it frames the document on its own origin, after handing the reader
   * across with a one-time ticket (lib/accounts/pages-sessions) in the frame's first URL. The JSON door
   * passes nothing and mints no ticket.
   */
  pages?: PagesSite;
}

const notFound = (): ArtifactPageAnswer => ({ status: 404, body: { error: 'not_found' } });

/**
 * A document frame's first URL for this request's reader (APP__PAGES_HOST): the pages apex exchange with
 * a one-time ticket (none for a guest), redirecting to the document's own origin — or null when the reader
 * may not read the document or it is not a document. `search` carries the reader's `$` values across.
 * The app page draws its frame with it; brief B's framed story asks for a fresh one (app/api/page/frame).
 */
export async function framedDocumentSrc(request: Request, id: string, site: PagesSite, search = ''): Promise<{ src: string; origin: string } | null> {
  if (!ID_RE.test(id)) return null;
  const artifact = await getArtifactById(id);
  if (!artifact || artifact.format !== 'markup') return null;
  const actor = await sessionActor(request);
  if (actor.tokenId !== artifact.token_id && !(await canReadArtifact(artifact, actor.viewer))) return null;
  return admittedFrameSrc(request, artifact, actor, site, search);
}

/** The frame's first URL for a reader this request already admitted to `artifact` (one admission per view). */
async function admittedFrameSrc(request: Request, artifact: ArtifactRow, actor: Awaited<ReturnType<typeof sessionActor>>, site: PagesSite, search: string): Promise<{ src: string; origin: string }> {
  const origin = pagesOriginFor(artifact.id, site);
  // The reader's "Allow once" grants live in an app-origin cookie the document's origin never sees: they ride the
  // ticket, and the document's origin reads them back as `pagesRequestOf(request).carried` (app/a/[id]/raw, /fetch).
  const carried = carriedTrust(request, { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null });
  // A browser session's scripted browser reads its frame as the session's actor (lib/accounts/pages-sessions).
  const ticket = await issuePagesTicket(actor, carried, Date.now(), { browserSession: isBrowserSessionRequest(request) });
  return { src: pagesSessionUrl(site, `${origin}/${search}`, ticket), origin };
}

/** The page's answer; a stored shape the current code no longer serves is its 410 (lib/artifacts/servable). */
export async function artifactPageAnswer(request: Request, id: string, options: ArtifactPageOptions = {}): Promise<ArtifactPageAnswer> {
  try { return await answerArtifactPage(request, id, options); }
  catch (error) {
    if (error instanceof UnservableDocument) return { status: error.status, body: { error: error.code, message: error.message } };
    throw error;
  }
}

async function answerArtifactPage(request: Request, id: string, options: ArtifactPageOptions): Promise<ArtifactPageAnswer> {
  if (!ID_RE.test(id)) return notFound();
  const admitted = options.admitted?.id === id ? options.admitted : null;
  const artifact = admitted ?? await getArtifactById(id);
  if (!artifact) return notFound();
  const search = new URL(request.url).searchParams;
  const key = search.get('key');
  const exporting = verifyExportKey(artifact.id, key ?? undefined);
  const actor = await sessionActor(request);
  if (!admitted && !exporting && actor.tokenId !== artifact.token_id && !(await canReadArtifact(artifact, actor.viewer))) return notFound();
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
   * this on idle.
   */
  if (search.get('part') === 'editor') {
    if (!isDoc || at || exporting || !canEdit(role)) return notFound();
    const { row, page } = await preparedPageFor(artifact, null);
    return { status: 200, body: {
      editId: artifact.edit_id, version: artifact.version, source: row.source ?? '',
      ...(artifact.document?.kind === 'graph' ? { document: artifact.document } : {}),
      compiledCss: await currentStoryCss((row.meta ?? {}) as { compiledCss?: string | null; cssCompileVersion?: string | null }, row.source),
      authorCss: page.authorCss,
    } };
  }

  // Everything below reads THIS row: the artifact wearing that version's bytes
  // when one was asked for, the artifact itself otherwise. A document's comes
  // with its prepared page (lib/publish/prepared/prepared-page.server) — a stored entry on
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
  const prepared = isDoc ? await preparedPageFor(artifact, at) : null;
  const row = prepared?.row ?? await servedRow(artifact, at);
  // Every document the app page serves is the prepared compiled page (§10) — a capture's and the
  // editor's address included — except the starter placeholder's READ view, whose agent instructions
  // are app UI (solid/pages/Starter). Its `/edit` opens the editor on the compiled placeholder
  // (solid/pages/Document), and a capture photographs the placeholder as the document it is.
  const starterDoc = isDoc && isStartPlaceholder(row.source ?? null, artifact.version);
  const editAddress = /\/edit\/?$/.test(new URL(request.url).pathname);

  const membershipAvailable = !at && prepared?.page.declared?.flow.mutations.some(m => 'import' in m.target) === true;
  const pwaEnabled = !at && artifactPwaEnabled(row);
  // The app page frames every document it serves — an archived version (`?version=N`, carried in the frame's
  // first URL) and the writer's `/edit` included — except the starter placeholder's READ view, whose agent
  // instructions are app UI (solid/pages/Starter). A capture photographs `/raw` itself (lib/export).
  const framing = !!options.pages && !!prepared && !(starterDoc && !editAddress);


  const meta = (row.meta ?? {}) as {
    theme?: StoryDesignName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  // A CAPTURE may be drawn in either mode (lib/mermaid-images harvests both); a reader sees the author's.
  const capturedColor = exporting ? captureColor(request.url) : null;
  const design = resolveStoredStoryDesign(meta.theme, capturedColor ?? meta.colorMode);
  // A document's sheet is its prepared page's; the data tiers keep their stored one.
  const compiledCss = isDoc ? null : meta.compiledCss ?? null;
  // What only this request decides, over the stored version. On the compiled page without this
  // reader's first results: its rows are the guest snapshot's, and this reader's arrive after paint.
  const servedFor = (results: boolean) => (prepared ? servedPage(prepared.row, prepared.page, {
    at, search: new URL(request.url).search,
    // This version's stored diagram drawings, unless the engine was asked for by name (`?mermaid=engine`).
    drawings: engineRequested(request.url) ? 'engine' : 'stored',
    colorMode: capturedColor,
    viewer: { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: actor.viewer?.email ?? null },
    // The first results, as the page's own query door (POST, this session) would answer them.
    ...(results ? { results: { admit: actor.viewer } } : {}),
  }) : Promise.resolve(null));
  const [firstServed, [author, forkedFrom, liked, likeCount, following, followCount, openAnnotations, dataPreview]] = await Promise.all([
    // A framed document runs its own first results on its own origin: the app page's answer carries none.
    servedFor(!framing),
    social,
  ]);
  const served = firstServed;
  const authorUsername = author?.username ?? null;
  const ownerScope = role === 'owner' ? actorForArtifacts(actor) : null;
  const hasInvitedUsers = ownerScope ? ((await getArtifactFor(ownerScope, id))?.shares?.length ?? 0) > 0 : false;
  const starter = starterDoc;
  const authorMark = { username: authorUsername, id: author?.id ?? null, image: author ? avatarUrl(author) : null, forkedFrom };
  const follow = artifact.user_id && artifact.user_id !== viewerId ? { userId: artifact.user_id, following, count: followCount } : null;

  // The ticket goes in the frame's first URL and is spent by the pages apex before the document loads.
  // The reader was admitted above (or by the caller) unless an export key stood in for the check: only then is it asked.
  const readerAdmitted = !!admitted || !exporting || actor.tokenId === artifact.token_id;
  const framedSrc = framing && artifact.format === 'markup' && (readerAdmitted || await canReadArtifact(artifact, actor.viewer))
    ? await admittedFrameSrc(request, artifact, actor, options.pages!, new URL(request.url).search) : null;
  const framedOrigin = framedSrc?.origin ?? null;
  const membership = membershipAvailable ? await membershipOf(actor, artifact.id) : undefined;
  const frame: DocumentFrame | null = framedSrc && prepared ? {
    src: framedSrc.src,
    title: row.title || prepared.page.title || 'Document',
    colorMode: design.colorMode ?? prepared.page.data.colorMode,
    head: {
      title: prepared.page.title,
      description: row.description,
      image: `${baseUrl(request)}/a/${artifact.id}/export?mode=card&r=${CARD_RENDER_GENERATION}`,
    },
  } : null;
  const surface = {
    pwaEnabled, membershipAvailable,
    captureKey: exporting ? key : null,
    id: artifact.id,
    editId: artifact.edit_id,
    format: artifact.format,
    visibility: artifact.visibility,
    ...(ownerScope ? { hasInvitedUsers } : {}),
    title: row.title,
    author: authorMark,
    ...(served ? {
      // The framed page's own sheet is the frame's: the app page's data carries the runtime without it.
      runtime: framing ? { ...served.runtime, css: undefined } : served.runtime,
      // What the reader's chrome derived from the source: the document's own
      // name (lib/document/title) and whether it is still the starter placeholder.
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
    // A stored FILE is not a document the app renders: its page shows the two
    // facts a person picks a file by, the link that opens it, and the browser's viewer.
    ...(artifact.format === 'pdf' || artifact.format === 'file' ? { bytes: (meta as { bytes?: number }).bytes ?? 0, pages: (meta as { pages?: number }).pages ?? null } : {}),
    // Its name picks the page's viewer (solid/components/FileViewer) by extension.
    ...(artifact.format === 'file' && typeof (meta as { filename?: unknown }).filename === 'string' ? { filename: (meta as { filename: string }).filename } : {}),
    theme: design.theme,
    colorMode: design.colorMode,
    template: meta.template ?? null,
    // Ids only: the data view that names a dataset is EDIT-only, and it
    // loads through /api/my/artifacts/:id where the join happens. A reader
    // never sees a ref's title, so nobody's page pays for the lookups.
    refs: meta.refs ?? [],
    accountSession: kind === 'account',
    anonSession: false,
    // The document's own origin when the app page frames it there (solid/pages/Document posts to it).
    ...(framedOrigin ? { framedOrigin } : {}),
    // The rail's Join/Joined/Pending pill (solid/document/DocumentChrome).
    ...(membership ? { membership } : {}),
    version: artifact.version,
    // Anyone who may COMMENT has a comment badge to fill: computing this
    // for the owner alone left an editor's and a commenter's count at 0
    // forever, on a control they were being shown.
    openAnnotations,
  };
  // What the document asks of the network beyond the default policy, and where this reader stands on it:
  // the consent bar (solid/document/CspConsentBar) draws from this. The served row is the version shown.
  const cspRequest = isDoc ? await cspRequestFor({ artifact: row, viewer: { userId: viewerId, tokenId: actor.tokenId }, request }) : null;
  const body = {
    canonical: canonicalArtifactPath(artifact, authorUsername),
    ...(cspRequest ? { cspRequest } : {}),
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
    follow,
    // A document's runtime carries its sheet once, isolated; the data tiers carry their stored one.
    surface,
  };
  if (frame) return { status: 200, body, frame, reader: { mode: 'compiled' } };
  return { status: 200, body };
}

/** The reader's standing on a document that writes to datasets: the rail's Join/Joined/Pending pill. */
async function membershipOf(viewer: Awaited<ReturnType<typeof sessionActor>>, id: string): Promise<'join' | 'pending' | 'joined'> {
  const actor = actorForArtifacts(viewer);
  const self = actor?.userId ? (await membershipState(actor, id)).self : null;
  return self?.status === 'accepted' && self.explicit_join ? 'joined' : self?.status === 'pending' ? 'pending' : 'join';
}

/**
 * The JSON door (app/api/page/artifact/[id]).
 *
 * Every role reads a markup document in the frame the HTML door draws (solid/pages/Document adopts it);
 * nothing renders a document from this answer. A client-side link to a document
 * reads it only to learn that the address is a document (solid/pages/ArtifactAddress `replaceDocument`), the
 * writer's editor reads `?part=editor`, and a dataset reader re-reads its catalog. So this door keeps
 * the non-compiled payload (`servedFor(true)`: the runtime and its first results), which those callers
 * and served-results.test.ts / prepared-page.test.ts depend on, and never names an app entry.
 */
export async function artifactPageResponse(request: Request, id: string): Promise<Response> {
  const answer = await artifactPageAnswer(request, id);
  return answer.status === 200 ? json(answer.body, 200, { 'Cache-Control': 'no-store' }) : json(answer.body, answer.status);
}
