import { artifactPwaEnabled } from './artifact-pwa.server';
import { membershipState, selfMembership } from '@/lib/artifacts';
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
 * stylesheet. An owner or editor fetches the source and the graph on the EDITOR door (`?part=editor`): on idle when
 * the document is small (`surface.sourceLength`), otherwise when edit mode opens.
 *
 * NOR DOES IT CARRY THE DOCUMENT'S NODE TREE: the app page only relays it to the framed document's edit
 * controller (solid/document/create-framed-story), which classifies comments and selections against it. On a large
 * page it was nearly the whole payload (98% of 2.6 MB measured), inlined into the HTML and again in the JSON. It is
 * the NODES door (`?part=nodes`), asked for while the frame loads. Access is decided from the row's header
 * (lib/artifacts getArtifactHeaderById): a reader who may not read the page is refused without the document being
 * loaded, and the document is read once, after admission.
 */
import { archivedVersionFor, servedRow } from '@/lib/artifacts';
import { UnservableDocument } from '@/lib/artifacts';
import { countOpenAnnotations } from '@/lib/annotations/store';
import { canReadArtifact, roleFor } from '@/lib/artifacts';
import { accessMoved, getArtifactById, getArtifactHeaderById, hasInvitedUsersFor } from '@/lib/artifacts';
import { folderPageFor } from '@/lib/workspace/folders';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { verifyExportKey } from '@/lib/platform/export-read-key';
import { baseUrl, json, parseCookie } from '@/lib/http/http';
import { forkedFromCredit } from './fork-credit.server';
import { ID_RE } from '@/lib/platform/ids';
import {
  actorForArtifacts, avatarUrl, browserSessionKind, count, getUserById, has, isBrowserSessionRequest,
  issuePagesTicket, ownerUsername, sessionActor,
} from '@/lib/accounts';
import { loadDatasetRows } from '@/lib/datasets/dataset-store';
import {ARTIFACT_FORMATS, type ArtifactFormat, canAnnotate, canEdit, CARD_RENDER_GENERATION, isStartPlaceholder} from '@artifactbin/contracts';
import {getGroupById} from '@/lib/groups';
import { canonicalArtifactPath } from '@/lib/http/urls';
import { accountWorkspaceFor } from '@/lib/workspace/dashboard';
import type { StoryDesignName } from '@/lib/validation/atlas-schemas';
import { preparedPageFor, servedPage, type TreelessServedRuntime } from '@/lib/publish/prepared/prepared-page.server';
import { codeFingerprint } from '@/lib/publish/prepared/revalidation.server';
import { etagOf, matchingTag, notModified, revalidationHeaders } from '@/lib/http/revalidation';
import { captureColor, engineRequested } from '@/lib/mermaid-images/store';
import { firstHeadingTitle, packDocumentGraph } from '@/lib/document';
import type { ArtifactHeader, ArtifactRow } from '@/lib/artifacts';
import { type StoryIslandData, THEME_KEY, withReaderMode } from '@/lib/story-runtime/contract';
import { pagesFrameUrl, pagesOriginFor, type PagesSite } from '../http/pages-origin';
import { carriedTrust, cspRequestFor } from '@/lib/trust/document-trust';
import type { DocumentFrame } from './document-frame';

export interface ArtifactPageAnswer {
  status: number;
  body: unknown;
  /** The document's frame, which the app page draws (lib/serving/document-frame): only the HTML door asks for it. */
  frame?: DocumentFrame;
  /** Which renderer answered a document's page (the page's `x-mx-reader` header): the compiled page, in its frame. */
  reader?: { mode: 'compiled' };
  /** The validator of a node or editor answer (lib/http/revalidation); with status 304 the body is the reader's own copy. */
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

function framedRuntime(runtime: TreelessServedRuntime): FramedRuntime {
  const { dataflow } = runtime.data;
  return { title: runtime.title, data: dataflow ? { dataflow } : {} };
}

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
  if (!artifact || artifact.format !== 'markup') return null;
  const actor = await sessionActor(request);
  if (actor.tokenId !== artifact.token_id && !(await canReadArtifact(artifact, actor.viewer))) return null;
  return admittedFrameSrc(request, artifact, actor, site, search, readerPickOf(request));
}

/** The frame's first URL for a reader this request already admitted to `artifact` (one admission per view). */
/** `mode` is the reader's pick the document is served in (its first URL says so), or null for its author's own. */
async function admittedFrameSrc(request: Request, artifact: Pick<ArtifactRow, 'id'>, actor: Awaited<ReturnType<typeof sessionActor>>, site: PagesSite, search: string, mode: 'light' | 'dark' | null): Promise<{ src: string; origin: string }> {
  const origin = pagesOriginFor(artifact.id, site);
  // The reader's "Allow once" grants live in an app-origin cookie the document's origin never sees: they ride the
  // ticket, and the document's origin reads them back as `pagesRequestOf(request).carried` (app/a/[id]/raw, /fetch).
  const carried = carriedTrust(request, { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null });
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
  if (!admitted && !exporting && actor.tokenId !== header.token_id && !(await canReadArtifact(header, actor.viewer))) return notFound();
  if (!ARTIFACT_FORMATS.includes(header.format as ArtifactFormat)) return notFound();
  if (!admitted && search.get('part') === 'kind') return kindAnswer(header);
  const artifact = admitted ?? await getArtifactById(id);
  if (!artifact) return notFound();
  // The row moved between the two reads (shared, made private, handed over): admission is asked again of the row served.
  if (!admitted && accessMoved(header, artifact) && !exporting && actor.tokenId !== artifact.token_id && !(await canReadArtifact(artifact, actor.viewer))) return notFound();

  // One role per request, beside the reads that need none of it.
  const groupId = (artifact as typeof artifact & { group_id?: string | null }).group_id ?? null;
  const [role, ownerGroup, kind] = await Promise.all([
    roleFor(artifact, actor),
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
   * THE EDITOR'S DOOR: what only writing needs — the source, and the document graph the editor addresses its edits
   * against. Nothing else: the reader payload carries neither, and the editor reads no stylesheet from here (its
   * compiled sheet is the frame's, its author sheet the source's). The graph travels in its wire form
   * (lib/document/document-graph-wire): the node keys, not the 20 fields per node the source already says. A graph
   * that form cannot reproduce exactly, and an explicit `?graph=full`, get the stored graph whole.
   */
  if (search.get('part') === 'editor') {
    if (!isDoc || at || exporting || !canEdit(role)) return notFound();
    const row = await servedRow(artifact, null);
    // `?probe=1`: only the admission above (and the 410 servedRow throws for a retired shape), for an editor that was
    // seeded earlier (solid/editor/ArtifactEditor asks again before it trusts a seed that may have outlived the access).
    if (search.get('probe') === '1') return { status: 200, body: { editId: artifact.edit_id, version: artifact.version } };
    // Revalidated like the document itself (lib/http/revalidation), after the access decision above: a tag is never an admission.
    const etag = partEtag('editor', artifact, role, at, search.get('graph'));
    const held = matchingTag(request.headers.get('if-none-match'), etag);
    if (held) return { status: 304, body: null, etag: held };
    const source = row.source ?? '';
    const stored = artifact.document?.kind === 'graph' ? artifact.document : null;
    const packed = stored && search.get('graph') !== 'full' ? packDocumentGraph(stored, source) : null;
    return { status: 200, etag, body: {
      editId: artifact.edit_id, version: artifact.version, source,
      ...(packed ? { graph: packed } : stored ? { document: stored } : {}),
    } };
  }

  /*
   * THE NODES' DOOR: the version's node tree, which the app page relays to the framed document's edit controller to
   * classify comments and selections against (solid/document/create-framed-story). Asked for by every reader while the
   * frame loads — it is not the reader payload because nothing the page DRAWS depends on it. Admitted exactly as the
   * page is (above); a version asked for is that version's tree (archivedVersionFor already refused whoever may not).
   */
  if (search.get('part') === 'nodes') {
    if (!isDoc || exporting) return notFound();
    const etag = partEtag('nodes', artifact, role, at, null);
    const held = matchingTag(request.headers.get('if-none-match'), etag);
    if (held) return { status: 304, body: null, etag: held };
    const { row, page } = await preparedPageFor(artifact, at, { nodes: true });
    return { status: 200, etag, body: { editId: artifact.edit_id, version: row.version, nodes: page.data.nodes } };
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
  // The shell only: the tree is the nodes door's and the compiled page is the document origin's.
  const prepared = isDoc ? await preparedPageFor(artifact, at, {}) : null;
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
  const framedDocument = !!prepared && !(starterDoc && !editAddress);
  // Only the HTML door draws the frame (and mints its ticket); both doors answer a framed document with its FramedRuntime.
  const framing = !!options.pages && framedDocument;


  const meta = (row.meta ?? {}) as {
    theme?: StoryDesignName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  // A CAPTURE may be drawn in either mode (lib/mermaid-images harvests both); a reader sees the author's.
  const capturedColor = exporting ? captureColor(request.url) : null;
  // The reader's own pick draws the frame (its ground, and the mode its first URL asks for) — never at the writer's
  // `/edit`, whose preview is the document's own Mode setting, and never for a capture.
  const readerPick = framing && !exporting && !editAddress ? readerPickOf(request) : null;
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
  const ownerScope = role === 'owner' ? actorForArtifacts(actor) : null;
  // The reader was admitted above (or by the caller) unless an export key stood in for the check: only then is it asked.
  const readerAdmitted = !!admitted || !exporting || actor.tokenId === artifact.token_id;
  // Beside the served runtime and the social reads, not after them: none depends on another.
  const [firstServed, [author, forkedFrom, liked, likeCount, following, followCount, openAnnotations, dataPreview], hasInvitedUsers, framedSrc, membership, cspRequest] = await Promise.all([
    // A framed document runs its own first results on its own origin: the app's answer, through either door, carries none.
    servedFor(!framedDocument),
    social,
    ownerScope ? hasInvitedUsersFor(ownerScope, id) : Promise.resolve(false),
    // The ticket goes in the frame's first URL and is spent by the pages apex before the document loads.
    framing && artifact.format === 'markup' && (readerAdmitted || await canReadArtifact(artifact, actor.viewer))
      ? admittedFrameSrc(request, artifact, actor, options.pages!, new URL(request.url).search, readerPick) : Promise.resolve(null),
    membershipAvailable ? membershipOf(actor, artifact.id, readerAdmitted) : Promise.resolve(undefined),
    // What the document asks of the network beyond the default policy, and where this reader stands on it:
    // the consent bar (solid/document/CspConsentBar) draws from this. The served row is the version shown.
    isDoc ? cspRequestFor({ artifact: row, viewer: { userId: viewerId, tokenId: actor.tokenId }, request }) : Promise.resolve(null),
  ] as const);
  const served = firstServed;
  const authorUsername = author?.username ?? null;
  const starter = starterDoc;
  const authorMark = { username: authorUsername, id: author?.id ?? null, image: author ? avatarUrl(author) : null, forkedFrom };
  const follow = artifact.user_id && artifact.user_id !== viewerId ? { userId: artifact.user_id, following, count: followCount } : null;

  const framedOrigin = framedSrc?.origin ?? null;
  const frame: DocumentFrame | null = framedSrc && prepared ? {
    src: framedSrc.src,
    title: row.title || prepared.page.title || 'Document',
    colorMode: readerPick ?? design.colorMode ?? prepared.page.data.colorMode,
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
    group_id: groupId,
    editId: artifact.edit_id,
    format: artifact.format,
    visibility: artifact.visibility,
    ...(ownerScope ? { hasInvitedUsers } : {}),
    title: row.title,
    author: authorMark,
    ...(served ? {
      // The framed page's own sheet, script and reader data are the frame's, and the tree is the nodes door's: the
      // app keeps what it reads (FramedRuntime), whichever door it asked. The starter's read view, which is app UI
      // rather than a frame, keeps the whole served runtime, less the tree.
      runtime: (framedDocument ? framedRuntime(served.runtime) : served.runtime) satisfies FramedRuntime,
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
    // What the editor's door will cost, so the page prefetches it on idle only when it is cheap (solid/pages/Document).
    ...(isDoc && !at && canEdit(role) ? { sourceLength: (row.source ?? '').length } : {}),
  };
  // Why the head runs without its script (prepared-page.server authorScriptErrors), for someone who can republish it
  // (solid/document/ScriptFailureNotice). A reader has the framed document's own notice and never the builder's words.
  const scriptErrors = isDoc && !at && canEdit(role) ? prepared?.page.authorScriptErrors : undefined;
  const body = {
    canonical: canonicalArtifactPath(artifact, groupId ? ownerGroup?.handle ?? null : authorUsername),
    ...(cspRequest ? { cspRequest } : {}),
    ...(scriptErrors?.length ? { scriptFailure: { errors: scriptErrors } } : {}),
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

/**
 * The reader's standing on a document that writes to datasets: the rail's Join/Joined/Pending pill. A reader this request
 * already admitted needs only their own join row; one an export key stood in for is admitted by the full check.
 */
async function membershipOf(viewer: Awaited<ReturnType<typeof sessionActor>>, id: string, admitted: boolean): Promise<'join' | 'pending' | 'joined'> {
  const actor = actorForArtifacts(viewer);
  const self = actor?.userId ? (admitted ? await selfMembership(actor, id) : (await membershipState(actor, id)).self) : null;
  return self?.status === 'accepted' && self.explicit_join ? 'joined' : self?.status === 'pending' ? 'pending' : 'join';
}

/**
 * The JSON door (app/api/page/artifact/[id]).
 *
 * Every role reads a markup document in the frame the HTML door draws (solid/pages/Document adopts it);
 * nothing renders a document from this answer. A client navigation to an address of unknown kind asks `?part=kind`
 * first and crosses to the server for a document without reading this answer (solid/pages/ArtifactAddress
 * `replaceDocument`), the writer's editor reads `?part=editor`, the framed document's edit controller reads
 * `?part=nodes`, and a dataset reader re-reads its catalog. So a framed document's answer carries the same
 * `FramedRuntime` as the HTML door's (the title and declared dataflow, nothing the frame draws from): measured at
 * 211 KB on a large document, of which the sheet, system sheet and author script were 209 KB that nothing here
 * reads. The full served runtime is built for /raw, draft preview and prepared pages, none of which come through
 * this door. It never names an app entry.
 */
export async function artifactPageResponse(request: Request, id: string): Promise<Response> {
  const answer = await artifactPageAnswer(request, id);
  if (answer.status === 304 && answer.etag) return notModified(answer.etag);
  return answer.status === 200 ? json(answer.body, 200, answer.etag ? revalidationHeaders(answer.etag) : { 'Cache-Control': 'no-store' }) : json(answer.body, answer.status);
}

/**
 * The validator of a node or editor answer: what determines the bytes is the version and edit it reads, the role that was
 * admitted to it, and the code that prepares a page (a deploy that changes how nodes are made changes the tag).
 */
function partEtag(part: 'nodes' | 'editor', artifact: ArtifactRow, role: string, at: { version: number } | null, graph: string | null): string {
  return etagOf({ part, id: artifact.id, version: artifact.version, edit: artifact.edit_id, updated: artifact.updated_at, stored: artifact.document?.kind ?? null, graph, role, at: at?.version ?? null, code: codeFingerprint() });
}
