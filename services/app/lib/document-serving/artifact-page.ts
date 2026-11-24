import {userPageUrl} from '@/lib/user-pages';
import {htmlAppearance} from '@/lib/html-page';
import {designSystemChoice} from '@/lib/html-systems';
import {artifactPwaEnabled} from './artifact-pwa.server';
import { nativeHtmlTitle } from './native-html.server';
import { liveConnectionOf, publicCatalogOf, loadDatasetRows } from '@/lib/datasets';
import { datasetReadAccess, datasetRowsFor, sqlRefusal, viewCatalog } from '@/lib/dataset-permissions';
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
import { admitRead, archivedVersionFor, currentPage, readPageRow, servedRow, UnservableDocument, accessMoved, getArtifactHeaderById, hasInvitedUsersFor, type ArtifactHeader, type ArtifactRow, type PageRead } from '@/lib/artifacts';
import { holdsCreatingToken, effectiveRole, managesSharing, requestAccessFacts } from '@/lib/artifact-access';
import { folderPageFor, accountWorkspaceFor } from '@/lib/workspace';
import { resolveStoredStoryDesign } from '@/lib/html-systems';
import { verifyExportKey } from '@/lib/export';
import { baseUrl, json, parseCookie, canonicalArtifactPath } from '@/lib/http';
import { forkedFromCredit } from './fork-credit.server';
import { ID_RE } from '@/lib/platform';
import { avatarUrl } from '@/lib/avatars';
import { browserSessionKind, isBrowserSessionRequest, requestOrSessionActor, sessionActor } from '@/lib/authentication';
import { pageSocial } from '@/lib/social';
import { issuePagesTicket, getUserById } from '@/lib/accounts';
import {ARTIFACT_FORMATS, type ArtifactFormat} from '@artifactbin/contracts/artifact-format';
import {CARD_RENDER_GENERATION} from '@artifactbin/contracts/og-card';
import {getGroupById} from '@/lib/groups';
import type { StoryDesignName } from '@/lib/validation';
import { captureColor } from '@/lib/mermaid-images';
import { THEME_KEY, withReaderMode } from '@/lib/html-reader/contract';
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
}

/** What the app page (never the JSON door) hands the answer. */
interface ArtifactPageOptions {
  /**
   * The row the caller already fetched AND admitted for this very request (server/document-address
   * admitDocumentAddress): the answer neither fetches it again nor decides admission again — one row
   * fetch and one access check per view.
   */
  admitted?: ArtifactRow;
  /** With `admitted`: the live revision read with it (lib/artifacts readPageRow), so the view reads it no second time. */
  admittedRevision?: PageRead['revision'];
  /** Canonical path already resolved by the HTML door, even when the byline is loaded later. */
  admittedCanonical?: string;
  admittedPublishedUrl?: string | null;
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
 * reaches this page.
 */
export interface FramedRuntime { title: string; data: Record<string,never> }

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

export interface FreshFrame {
  src: string;
  /** The document's own origin, the only one its messages count from. */
  origin: string;
  /** The one parent origin the document trusts: a page that frames it anywhere else is refused by its door. */
  appOrigin: string;
  /** The head the frame is served (the trusted revision a relay pins) and its edit pointer, as the app page's bootstrap has them. */
  revision: string;
  editId: string;
}
export async function framedDocumentSrc(request: Request, id: string, site: PagesSite, search = ''): Promise<FreshFrame | null> {
  if (!ID_RE.test(id)) return null;
  // The frame's address needs the row's identity and format, never its document.
  const artifact = await getArtifactHeaderById(id);
  if (!artifact || artifact.format !== 'html') return null;
  const actor = await sessionActor(request);
  if (!(await admitRead(artifact, actor))) return null;
  return { ...await admittedFrameSrc(request, artifact, actor, site, search, readerPickOf(request)), appOrigin: site.app, revision: String(artifact.version), editId: artifact.edit_id };
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

async function readDocumentChrome(row: Pick<ArtifactHeader, 'id' | 'user_id' | 'forked_from'>, actor: Awaited<ReturnType<typeof sessionActor>>, owner: boolean, annotations: boolean) {
  const [social, forkedFrom, hasInvitedUsers] = await Promise.all([
    pageSocial({ artifactId: row.id, authorId: row.user_id, viewerId: actor.userId, annotations }),
    forkedFromCredit(row.forked_from),
    owner ? hasInvitedUsersFor(actor, row.id) : false,
  ]);
  const { author, liked, likeCount, following, followCount, openAnnotations } = social;
  return {
    author: { name: author?.name ?? null, username: author?.username ?? null, id: author?.id ?? null, image: author ? avatarUrl(author) : null, forkedFrom },
    like: { liked, count: likeCount },
    follow: row.user_id && row.user_id !== actor.userId ? { userId: row.user_id, following, count: followCount } : null,
    openAnnotations,
    ...(owner ? { hasInvitedUsers } : {}),
  };
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
  // Who may read it is decided from the header (no document); the document is loaded once, after admission.
  const header = admitted ?? await getArtifactHeaderById(id);
  if (!header) return notFound();
  const search = new URL(request.url).searchParams;
  const key = search.get('key');
  const exporting = verifyExportKey(header.id, key ?? undefined);
  const actor = await sessionActor(request);
  // Every role decision this view makes reads one memo of the actor's access facts, shared with the app page's own
  // admission of this very request (server/document-address admitDocumentAddress): the role is resolved once per view.
  const facts = requestAccessFacts(request, actor, header.id);
  if (!admitted && !(await admitRead(header, actor, { facts, exporting }))) return notFound();
  if (header.format === 'markup' || header.format === 'program' || !ARTIFACT_FORMATS.includes(header.format as ArtifactFormat)) return notFound();
  if (!admitted && search.get('part') === 'kind') return kindAnswer(header);
  if (!options.pages && search.get('part') === 'chrome') {
    // The current reader must still be admitted. An export key never buys interactive chrome.
    if (header.format !== 'html' || exporting || search.has('version')) return notFound();
    const role = await effectiveRole(header, actor, facts);
    return { status: 200, body: await readDocumentChrome(header, actor, role === 'owner', true) };
  }
  // The row and its live revision in one statement (lib/artifacts readPageRow): the current page costs no read of its own.
  const read = admitted ? null : await readPageRow(id);
  const artifact = admitted ?? read?.row;
  const revision = admitted ? options.admittedRevision : read?.revision;
  if (!artifact) return notFound();
  // The row moved between the two reads (shared, made private, handed over): admission is asked again of the row served.
  if (!admitted && accessMoved(header, artifact) && !(await admitRead(artifact, actor, { facts, exporting }))) return notFound();

  // One role per request, beside the reads that need none of it.
  const groupId = (artifact as typeof artifact & { group_id?: string | null }).group_id ?? null;
  const [role, ownerGroup, kind] = await Promise.all([
    effectiveRole(artifact, actor, facts),
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
   * A folder has no
   * source to compile a sheet for, no declarations to seed, no annotations to
   * count and nothing to frame.
   */
  if (artifact.format === 'folder') {
    const person = !groupId && artifact.user_id ? await getUserById(artifact.user_id) : null;
    const handle = ownerGroup?.handle ?? person?.username ?? null;
    const [folder, workspace] = await Promise.all([
      folderPageFor(artifact, actor),
      role === 'owner' && actor.userId
        ? accountWorkspaceFor(actor.userId, actor.email)
        : Promise.resolve(null),
    ]);
    return { status: 200, body: {
      canonical: canonicalArtifactPath(artifact, handle),
      ownerUsername: handle,
      ownerName: person?.username ? person.name : null,
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
  const part = search.get('part');
  if (part !== null && part !== 'kind' && part !== 'chrome') return notFound();

  // Source stays on the runner origin; independent shell reads run beside one another.
  // A dataset page shows the reader's role view (lib/dataset-permissions); its creating token and an export read whole.
  // A LIVE dataset's page is its connection (lib/live-datasets): its sharing admitted the reader; it has no rows here.
  const liveConnection = artifact.format === 'dataset' ? liveConnectionOf(artifact.meta) : null;
  const datasetDecision = artifact.format === 'dataset' && !liveConnection && !exporting && !holdsCreatingToken(artifact, actor) ? await datasetReadAccess(artifact, actor) : null;
  if (datasetDecision && !datasetDecision.allowed) return notFound();
  const starter = nativeHtml && !at && artifact.version === 1 && artifact.meta.startPlaceholder === true;
  // Keep guest cache hits, history, capture and non-frame surfaces on their original bootstrap.
  const deferChrome = !!(options.pages && admitted && options.admittedCanonical && actor.userId && nativeHtml && !at && !exporting && !starter);
  const readerPick = options.pages && nativeHtml && !exporting ? readerPickOf(request) : null;
  const [page, chrome, dataPreview, framedSrc, publishedUrl, cspRequest] = await Promise.all([
    nativeHtml && !at ? currentPage(artifact, revision ? { revision } : {}) : null,
    deferChrome ? null : readDocumentChrome(artifact, actor, role === 'owner', nativeHtml),
    liveConnection ? '[]' : artifact.format === 'dataset' ? (datasetDecision && !datasetDecision.full ? datasetRowsFor(datasetDecision, artifact) : loadDatasetRows(artifact)).then(rows => JSON.stringify(rows)) : (artifact.format === 'viz' ? artifact.source ?? '' : ''),
    options.pages && nativeHtml ? (async (site) => {
      // An export key admits the page, never its frame: a keyed capture is framed only for a reader the rule admits.
      if (exporting && !admitted && !(await admitRead(artifact, actor, { facts }))) return null;
      return admittedFrameSrc(request, artifact, actor, site, new URL(request.url).search, readerPick);
    })(options.pages) : null,
    admitted && options.admittedPublishedUrl !== undefined ? options.admittedPublishedUrl : userPageUrl(artifact),
    nativeHtml ? cspRequestFor({artifact:{id:artifact.id,version:at?.version??artifact.version,declared:storedCspExtensions((at?.meta ?? artifact.meta).htmlCsp)},viewer:actor,request}) : undefined,
  ] as const);
  const row = page ? { ...servedRow(artifact, at), source: page.row.source, title: page.row.title } : servedRow(artifact, at);
  const pwaEnabled = artifactPwaEnabled(row);

  const meta = (row.meta ?? {}) as {
    theme?: StoryDesignName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  // A CAPTURE may be drawn in either mode (lib/mermaid-images harvests both); a reader sees the author's.
  const capturedColor = exporting ? captureColor(request.url) : null;
  // Captures use their requested mode; readers keep their own preference.
  // An HTML page's design system and default mode are what its core applies.
  const look = nativeHtml ? htmlAppearance(row.source ?? '', designSystemChoice(artifact.meta)) : null;
  const design = look ? { theme: (look.designSystem ?? null) as StoryDesignName | null, colorMode: capturedColor ?? look.mode } : resolveStoredStoryDesign(meta.theme, capturedColor ?? meta.colorMode);
  const compiledCss = nativeHtml ? null : meta.compiledCss ?? null;
  const documentTitle = nativeHtml ? nativeHtmlTitle(row) : null;

  const framedOrigin = framedSrc?.origin ?? null;
  const frame: DocumentFrame | null = framedSrc && documentTitle !== null && !starter ? {
    src: framedSrc.src,
    contentUrl: `/a/${artifact.id}/raw${at ? `?version=${at.version}` : ''}`,
    title: documentTitle,
    colorMode: readerPick ?? design.colorMode ?? 'light',
    head: {
      title: documentTitle,
      description: row.description,
      // `v`: a new card is a new URL. Chat apps cache an unfurl's image by its URL, so a card that changed (a new share
      // image, an edit) under the same URL kept showing the old one; the raw door's head already carried it.
      image: `${baseUrl(request)}/a/${artifact.id}/export?mode=card&v=${at?.version ?? artifact.version}&r=${CARD_RENDER_GENERATION}`,
    },
  } : null;
  const surface = {
    pwaEnabled,
    captureKey: exporting ? key : null,
    id: artifact.id,
    group_id: groupId,
    editId: artifact.edit_id,
    format: artifact.format,
    visibility: artifact.visibility,
    user_page_url: publishedUrl,
    ...(chrome?.hasInvitedUsers !== undefined ? { hasInvitedUsers: chrome.hasInvitedUsers } : {}),
    title: documentTitle ?? row.title,
    ...(chrome ? { author: chrome.author } : {}),
    ...(documentTitle !== null ? {
      // The framed page's sheet, script and reader data stay in the frame. The app keeps the minimal runtime (FramedRuntime).
      runtime: ({ title: documentTitle, data: {} }) satisfies FramedRuntime,
      // What the reader's chrome derived from the source: the document's own
      // name (lib/document/title) and whether it is still the starter placeholder.
      heading: row.title, starter,
      ...(options.pages ? { hasEditableRegions: /data-af-editable/i.test(row.source ?? '') } : {}),
    } : {
      // The data tiers: their source is their content (a dataset's only for those who may edit it).
      source: artifact.format==='dataset'&&role!=='owner'&&role!=='editor'?null:row.source,
      compiledCss,
      // What a writer's editor needs to open without a round trip, for non-document formats.
      ...(row.document?.kind==='graph'?{document:row.document}:{}),
    }),
    dataPreview,
    columns: meta.columns ?? [],
    ...(liveConnection ? { liveConnection } : {}),
    ...(artifact.format==='dataset' && (artifact.meta as Record<string,unknown>).catalog ? {catalog:datasetDecision?.allowed?viewCatalog(datasetDecision,publicCatalogOf(artifact)!):publicCatalogOf(artifact)!,
      // May the reader run SQL in the explorer (dataset-permissions `sqlRefusal`, the check its door applies)? A creator holding its token owns it.
      canRunSql:datasetDecision?!sqlRefusal(datasetDecision):true}:{}),
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
    // The document's own origin when the app page frames it there (solid/pages/Document posts to it).
    ...(framedOrigin ? { framedOrigin } : {}),
    // The rail's Join/Joined/Pending pill (solid/document/DocumentChrome).
    version: nativeHtml ? at?.version ?? artifact.version : artifact.version,
    // Anyone who may COMMENT has a comment badge to fill: computing this
    // for the owner alone left an editor's and a commenter's count at 0
    // forever, on a control they were being shown.
    ...(chrome ? { openAnnotations: chrome.openAnnotations } : {}),
  };
  const body = {
    canonical: deferChrome && !groupId ? options.admittedCanonical : canonicalArtifactPath(artifact, groupId ? ownerGroup?.handle ?? null : chrome?.author.username ?? null),
    description: row.description,
    ...(cspRequest ? { cspRequest } : {}),
    role,
    // Edit access is not sharing authority: an editor by link alone sees no Sharing action (lib/artifact-access `managesSharing`).
    canManageSharing: role === 'owner' || (role === 'editor' && await managesSharing(artifact, actor, facts)),
    kind,
    /*
     * WHICH VERSION THIS IS, beside `surface` rather than inside it — the
     * surface's own props are what the DOCUMENT is, and this is what the RENDER
     * is: the page draws the banner from it and shuts edit, comment, like, fork
     * and share on it. Absent entirely for the head, so no page that did not
     * ask for a version can accidentally read one.
     */
    ...(at ? { archived: { version: at.version, head: at.head } } : {}),
    ...(chrome ? { like: chrome.like, follow: chrome.follow } : { deferredChrome: true }),
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
 * `replaceDocument`), and a dataset reader re-reads its catalog. The document's answer carries the same
 * `FramedRuntime` as the HTML door's (the title and declared dataflow, nothing the frame draws from): measured at
 * 211 KB on a large document, of which the sheet, system sheet and author script were 209 KB that nothing here
 * reads. The full served runtime is built for /raw, draft preview and prepared pages, none of which come through
 * this door. It never names an app entry.
 */
export async function artifactPageResponse(request: Request, id: string): Promise<Response> {
  const answer = await artifactPageAnswer(request, id);
  return answer.status === 200 ? json(answer.body, 200, { 'Cache-Control': NO_STORE }) : json(answer.body, answer.status);
}
