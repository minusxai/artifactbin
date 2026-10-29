import {htmlAppearance} from '@/lib/html-page';
import {designSystemChoice} from '@/lib/html-systems';
import {artifactPwaEnabled} from './artifact-pwa.server';
import { nativeHtmlTitle } from './native-html.server';
import { publicCatalogOf, loadDatasetRows } from '@/lib/datasets';
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
 * A native HTML document is assembled only on its runner origin. This answer
 * carries its original sharing/comment shell and a ticketed frame, never its source.
 */
import { archivedVersionFor, servedRow, holdsCreatingToken, UnservableDocument, canReadArtifact, effectiveRole, accessMoved, getArtifactById, getArtifactHeaderById, hasInvitedUsersFor, type ArtifactHeader, type ArtifactRow } from '@/lib/artifacts';
import { countOpenAnnotations } from '@/lib/annotations';
import { folderPageFor, accountWorkspaceFor } from '@/lib/workspace';
import { resolveStoredStoryDesign } from '@/lib/data';
import { verifyExportKey } from '@/lib/export';
import { baseUrl, json, parseCookie, canonicalArtifactPath, etagOf, matchingTag, notModified, revalidationHeaders } from '@/lib/http';
import { forkedFromCredit } from './fork-credit.server';
import { ID_RE } from '@/lib/platform';
import { avatarUrl } from '@/lib/avatars';
import { browserSessionKind, isBrowserSessionRequest, requestOrSessionActor, sessionActor } from '@/lib/authentication';
import { count, has } from '@/lib/social';
import { getUserById, issuePagesTicket, ownerUsername } from '@/lib/accounts';
import {ARTIFACT_FORMATS, type ArtifactFormat, CARD_RENDER_GENERATION} from '@artifactbin/contracts';
import {getGroupById} from '@/lib/groups';
import type { StoryDesignName } from '@/lib/validation';
import { captureColor } from '@/lib/mermaid-images';
import { type StoryIslandData, THEME_KEY, withReaderMode } from '@/lib/story-runtime/contract';
import { pagesFrameUrl, pagesOriginFor, type PagesSite } from '../http';
import {storedCspExtensions} from '@/lib/document';
import { carriedTrust,cspRequestFor } from '@/lib/trust';
import type { DocumentFrame } from './document-frame';
import { NO_STORE } from './cache-control';

export interface ArtifactPageAnswer {
  status: number;
  body: unknown;
  /** The document's frame, which the app page draws (lib/document-serving/document-frame): only the HTML door asks for it. */
  frame?: DocumentFrame;
  /** Which renderer answered a document's page (the page's `x-mx-reader` header): the compiled page, in its frame. */
  reader?: { mode: 'compiled' };
  /** The validator of a node answer (lib/http/revalidation); with status 304 the body is the reader's own copy. */
  etag?: string;
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
   * across with a one-time ticket (lib/accounts/pages-sessions) in the frame's first URL, on its own origin. The JSON door
   * passes nothing and mints no ticket.
   */
  pages?: PagesSite;
}

const notFound = (): ArtifactPageAnswer => ({ status: 404, body: { error: 'not_found' } });

/**
 * What the app page reads of a FRAMED document's runtime (solid/pages/Document): its title, and the declared
 * dataflow the editor opens on and the live stream's cursor. The runtime itself runs in the frame, on the
 * document's own origin; the rest of the served runtime (sheets, overrides, author script, reader data) never
 * reaches this page, and the tree is the nodes door's.
 */
export interface FramedRuntime { title: string; data: Pick<StoryIslandData, 'dataflow'> }

/**
 * A document frame's first URL for this request's reader (APP__PAGES_HOST): the document's own origin carrying a
 * one-time ticket for exactly that document (the explicit guest marker for a guest), spent in the response that
 * serves the document (server/pages-host) — or null when the reader
 * may not read the document or it is not a document. `search` carries the reader's `$` values across.
 * The app page draws its frame with it; brief B's framed story asks for a fresh one (app/api/page/frame).
 */
/**
 * The reader's explicit light/dark pick, as the app origin keeps it for its server (the `mx_theme` cookie
 * lib/story-runtime/reader-mode chooseTheme writes), or null: a reader who never picked reads every document in its
 * author's mode. The app page carrying it is never cached (`no-store`); the document it frames is told it in its
 * first URL, so the document's own validator names it (app/a/[id]/raw).
 */
function readerPickOf(request: Request): 'light' | 'dark' | null {
  const value = parseCookie(request.headers.get('cookie'), THEME_KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

export async function framedDocumentSrc(request: Request, id: string, site: PagesSite, search = ''): Promise<{ src: string; origin: string } | null> {
  if (!ID_RE.test(id)) return null;
  // The frame's address needs the row's identity and format, never its document.
  const artifact = await getArtifactHeaderById(id);
  if (!artifact || artifact.format !== 'html') return null;
  const actor = await sessionActor(request);
  if (!holdsCreatingToken(artifact, actor) && !(await canReadArtifact(artifact, actor))) return null;
  return admittedFrameSrc(request, artifact, actor, site, search, readerPickOf(request));
}

/** The frame's first URL for a reader this request already admitted to `artifact` (one admission per view). */
/** `mode` is the reader's pick the document is served in (its first URL says so), or null for its author's own. */
async function admittedFrameSrc(request: Request, artifact: Pick<ArtifactRow, 'id'>, actor: Awaited<ReturnType<typeof sessionActor>>, site: PagesSite, search: string, mode: 'light' | 'dark' | null): Promise<{ src: string; origin: string }> {
  const origin = pagesOriginFor(artifact.id, site);
  // The reader's "Allow once" grants live in an app-origin cookie the document's origin never sees: they ride the
  // ticket, and the document's origin reads them back as `pagesRequestOf(request).carried` (app/a/[id]/raw, /fetch).
  const carried = carriedTrust(request, actor);
  // A browser session's scripted browser reads its frame as the session's actor (lib/accounts/pages-sessions).
  // The ticket is for THIS document at this exact origin, and is spent there (server/pages-host): the frame's first URL is the document's own.
  const ticket = await issuePagesTicket(actor, carried, Date.now(), { browserSession: isBrowserSessionRequest(request), artifactId: artifact.id, origin });
  return { src: pagesFrameUrl(origin, withReaderMode(search, mode), ticket), origin };
}

/**
 * THE KIND DOOR (`?part=kind`): only what a client navigation to an address it knows nothing about needs first, to
 * decide between crossing to the server (a document, whose page carries its own bootstrap) and asking for the full
 * answer (everything else) — solid/pages/ArtifactAddress. Admitted by the caller exactly as the page is, then answered
 * from the header alone: no document, no runtime, no social reads, and the 410 of a retired stored shape is the full
 * door's to give once the document is asked for.
 */
const kindAnswer = (header: Pick<ArtifactHeader, 'format'>): ArtifactPageAnswer => ({ status: 200, body: { format: header.format } });

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
  // Who may read it is decided from the header (no document); the document is loaded once, after admission.
  const header = admitted ?? await getArtifactHeaderById(id);
  if (!header) return notFound();
  const search = new URL(request.url).searchParams;
  const key = search.get('key');
  const exporting = verifyExportKey(header.id, key ?? undefined);
  const actor = await sessionActor(request);
  if (!admitted && !exporting && !holdsCreatingToken(header, actor) && !(await canReadArtifact(header, actor))) return notFound();
  if (header.format === 'markup' || header.format === 'program' || !ARTIFACT_FORMATS.includes(header.format as ArtifactFormat)) return notFound();
  if (!admitted && search.get('part') === 'kind') return kindAnswer(header);
  const artifact = admitted ?? await getArtifactById(id);
  if (!artifact) return notFound();
  // The row moved between the two reads (shared, made private, handed over): admission is asked again of the row served.
  if (!admitted && accessMoved(header, artifact) && !exporting && !holdsCreatingToken(artifact, actor) && !(await canReadArtifact(artifact, actor))) return notFound();

  // One role per request, beside the reads that need none of it.
  const groupId = (artifact as typeof artifact & { group_id?: string | null }).group_id ?? null;
  const [role, ownerGroup, kind] = await Promise.all([
    effectiveRole(artifact, actor),
    groupId ? getGroupById(groupId) : Promise.resolve(null),
    browserSessionKind(request, actor),
  ]);

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
    const handle = groupId ? ownerGroup?.handle ?? null : await ownerUsername(artifact.user_id);
    const [folder, workspace] = await Promise.all([
      folderPageFor(artifact, actor),
      role === 'owner' && actor.userId
        ? accountWorkspaceFor(actor.userId, actor.email)
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
  const at = await archivedVersionFor(request, artifact, () => requestOrSessionActor(request), { capture: exporting });
  if (at === 'not_found') return notFound();
  const nativeHtml = artifact.format === 'html';
  const isDoc = nativeHtml;

  // Browser source editing is no longer a document surface. Authoring APIs remain separate.
  if (search.get('part') === 'editor') return notFound();

  /*
   * THE NODES' DOOR: the version's node tree, which the app page relays to the framed document's edit controller to
   * classify comments and selections against (solid/document/create-framed-story). Asked for by every reader while the
   * frame loads — it is not the reader payload because nothing the page DRAWS depends on it. Admitted exactly as the
   * page is (above); a version asked for is that version's tree (archivedVersionFor already refused whoever may not).
   */
  if (search.get('part') === 'nodes') {
    if (!isDoc || exporting) return notFound();
    const etag = nodesEtag(artifact, role, at);
    const held = matchingTag(request.headers.get('if-none-match'), etag);
    if (held) return { status: 304, body: null, etag: held };
    return { status: 200, etag, body: { editId: artifact.edit_id, version: at?.version ?? artifact.version, nodes: [] } };
  }

  // Everything below reads THIS row: the artifact wearing that version's bytes
  // when one was asked for, the artifact itself otherwise. A document's comes
  // Source stays on the runner origin; independent shell reads run beside one another.
  const viewerId = actor.userId;
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
    isDoc ? countOpenAnnotations(artifact.id) : Promise.resolve(0),
    artifact.format === 'dataset' ? loadDatasetRows(artifact).then(rows => JSON.stringify(rows)) : Promise.resolve(isDoc ? '' : (artifact.format === 'viz' ? artifact.source ?? '' : '')),
  ] as const);
  // Awaited below; a failure of the preparation first must not leave this one unobserved.
  void social.catch(() => {});
  // The shell reads only this version's metadata.
  const row = servedRow(artifact, at);
  const membershipAvailable = false;
  const pwaEnabled = artifactPwaEnabled(row);
  const framedDocument = nativeHtml;
  // Only the HTML door draws the frame (and mints its ticket); both doors answer a framed document with its FramedRuntime.
  const framing = !!options.pages && framedDocument;


  const meta = (row.meta ?? {}) as {
    theme?: StoryDesignName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  // A CAPTURE may be drawn in either mode (lib/mermaid-images harvests both); a reader sees the author's.
  const capturedColor = exporting ? captureColor(request.url) : null;
  // Captures use their requested mode; readers keep their own preference.
  const readerPick = framing && !exporting ? readerPickOf(request) : null;
  // An HTML page's design system and default mode are what its core applies (lib/html-page/design-system): the owner's
  // saved choice, else the page's own meta, and the system's own default mode — so the reader's toggle starts right.
  const look = nativeHtml ? htmlAppearance(row.source ?? '', designSystemChoice(artifact.meta)) : null;
  const design = look ? { theme: (look.designSystem ?? null) as StoryDesignName | null, colorMode: capturedColor ?? look.mode } : resolveStoredStoryDesign(meta.theme, capturedColor ?? meta.colorMode);
  // A document's sheet is its prepared page's; the data tiers keep their stored one.
  const compiledCss = isDoc ? null : meta.compiledCss ?? null;
  const ownerScope = role === 'owner' ? actor : null;
  // The reader was admitted above (or by the caller) unless an export key stood in for the check: only then is it asked.
  const readerAdmitted = !!admitted || !exporting || holdsCreatingToken(artifact, actor);
  // Beside the served runtime and the social reads, not after them: none depends on another.
  const [[author, forkedFrom, liked, likeCount, following, followCount, openAnnotations, dataPreview], hasInvitedUsers, framedSrc] = await Promise.all([
    // A framed document runs its own first results on its own origin: the app's answer, through either door, carries none.
    social,
    ownerScope ? hasInvitedUsersFor(ownerScope, id) : Promise.resolve(false),
    // The ticket goes in the frame's first URL and is spent by the pages apex before the document loads.
    framing && isDoc && (readerAdmitted || await canReadArtifact(artifact, actor))
      ? admittedFrameSrc(request, artifact, actor, options.pages!, new URL(request.url).search, readerPick) : Promise.resolve(null),
  ] as const);
  const authorUsername = author?.username ?? null;
  const starter = nativeHtml && !at && row.version === 1 && row.meta.startPlaceholder === true;
  const authorMark = { username: authorUsername, id: author?.id ?? null, image: author ? avatarUrl(author) : null, forkedFrom };
  const follow = artifact.user_id && artifact.user_id !== viewerId ? { userId: artifact.user_id, following, count: followCount } : null;

  const framedOrigin = framedSrc?.origin ?? null;
  const frame: DocumentFrame | null = framedSrc && nativeHtml && !starter ? {
    src: framedSrc.src,
    contentUrl: `/a/${artifact.id}/raw${at ? `?version=${at.version}` : ''}`,
    title: nativeHtmlTitle(row),
    colorMode: readerPick ?? design.colorMode ?? 'light',
    head: {
      title: nativeHtmlTitle(row),
      description: row.description,
      // `v`: a new card is a new URL. Chat apps cache an unfurl's image by its URL, so a card that changed (a new share
      // image, an edit) under the same URL kept showing the old one; the raw door's head already carried it.
      image: `${baseUrl(request)}/a/${artifact.id}/export?mode=card&v=${at?.version ?? artifact.version}&r=${CARD_RENDER_GENERATION}`,
    },
  } : null;
  const surface = {
    pwaEnabled, membershipAvailable,
    captureKey: exporting ? key : null,
    id: artifact.id,
    group_id: groupId,
    editId: artifact.edit_id,
    format: artifact.format,
    visibility: artifact.visibility,
    ...(ownerScope ? { hasInvitedUsers } : {}),
    title: nativeHtml ? nativeHtmlTitle(row) : row.title,
    author: authorMark,
    ...(nativeHtml ? {
      // The framed page's own sheet, script and reader data are the frame's, and the tree is the nodes door's: the
      // app keeps what it reads (FramedRuntime), whichever door it asked. The starter's read view, which is app UI
      // rather than a frame, keeps the whole served runtime, less the tree.
      runtime: ({ title: nativeHtmlTitle(row), data: {} }) satisfies FramedRuntime,
      // What the reader's chrome derived from the source: the document's own
      // name (lib/document/title) and whether it is still the starter placeholder.
      heading: row.title, starter,
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
    version: nativeHtml ? at?.version ?? artifact.version : artifact.version,
    // Anyone who may COMMENT has a comment badge to fill: computing this
    // for the owner alone left an editor's and a commenter's count at 0
    // forever, on a control they were being shown.
    openAnnotations,
  };
  const body = {
    canonical: canonicalArtifactPath(artifact, groupId ? ownerGroup?.handle ?? null : authorUsername),
    description: row.description,
    ...(nativeHtml?{cspRequest:await cspRequestFor({artifact:{id:row.id,version:at?.version??artifact.version,declared:storedCspExtensions(row.meta.htmlCsp)},viewer:actor,request})}:{}),
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

/**
 * The JSON door (app/api/page/artifact/[id]).
 *
 * Every role reads a native HTML document in the frame the HTML door draws (solid/pages/Document adopts it);
 * nothing renders a document from this answer. A client navigation to an address of unknown kind asks `?part=kind`
 * first and crosses to the server for a document without reading this answer (solid/pages/ArtifactAddress
 * `replaceDocument`), the framed document's selection controller reads
 * `?part=nodes`, and a dataset reader re-reads its catalog. So a framed document's answer carries the same
 * `FramedRuntime` as the HTML door's (the title and declared dataflow, nothing the frame draws from): measured at
 * 211 KB on a large document, of which the sheet, system sheet and author script were 209 KB that nothing here
 * reads. The full served runtime is built for /raw, draft preview and prepared pages, none of which come through
 * this door. It never names an app entry.
 */
export async function artifactPageResponse(request: Request, id: string): Promise<Response> {
  const answer = await artifactPageAnswer(request, id);
  if (answer.status === 304 && answer.etag) return notModified(answer.etag);
  return answer.status === 200 ? json(answer.body, 200, answer.etag ? revalidationHeaders(answer.etag) : { 'Cache-Control': NO_STORE }) : json(answer.body, answer.status);
}

/**
 * The validator of a node answer: what determines the bytes is the version and edit it reads, the role that was
 * admitted to it, and the code that prepares a page (a deploy that changes how nodes are made changes the tag).
 */
function nodesEtag(artifact: ArtifactRow, role: string, at: { version: number } | null): string {
  return etagOf({ part: 'nodes', id: artifact.id, version: artifact.version, edit: artifact.edit_id, updated: artifact.updated_at, stored: artifact.document?.kind ?? null, role, at: at?.version ?? null });
}
