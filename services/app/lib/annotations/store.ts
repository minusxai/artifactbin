import { parseCommentViewState, type CommentViewState } from '../../../contracts/src/comment-view-state';
import { artifactQuery } from '@/lib/artifacts/table';
import {commentMentions} from './saved-mentions';
import { MembershipError, completeMutationReceipt, type MutationReceipt, readableArtifactHeader, type ArtifactRow } from '@/lib/artifacts';
import { reactionScope, annotationScope, effectiveRole, type Scope } from '@/lib/artifact-access';
import {consumeCommentImage,commentImagesFor} from './comment-images';
import type {CommentImageWire} from '../../../contracts/src/comment-image';
import type {RemoteWork,RemoteColor} from '../../../contracts/src/remote';
import { type AnnotationAuthor, type AnnotationCommentWire, type EventOrigin, annotationsChannel, canGovern, type CommentReactionInput, type CommentReactionSummary, type CommentReactor, COMMENT_REACTORS_MAX } from '@artifactbin/contracts';
/**
 * ANNOTATIONS — human/agent comments pinned to nodes of a document. The ONLY reader/writer of the
 * `annotations` table.
 *
 * Comments store relations to source nodes; creating, replying to or resolving a
 * thread does not edit the document. Current node IDs and legacy anchor keys
 * are resolved against the current source. Missing targets are orphaned for
 * that read; restoring the target can re-anchor the thread.
 *
 * COORDINATE NOTE (the Helmet-offset lesson): the frame speaks BODY paths; the
 * source counts from the top. Listing translates the found node's source path
 * to a body path (`sourcePathToBodyPath`). Nothing in between converts.
 */
import type { AccessActor } from '@/lib/accounts';
import { canonicalQuote, parseAnnotationRange, type AnnotationRange, isAreaRange } from '@/lib/document';
import { avatarUrl } from '@/lib/avatars';
import { getDb, type Queryable, actorSubject, generateInternalId, recordEvent } from '@/lib/platform';
import { parseHtmlNodeAnchor, type HtmlNodeAnchor } from '@artifactbin/contracts';
import { htmlCommentNodes, resolveHtmlCommentAnchor } from './html-anchor';


/** Where an annotation points, in CURRENT head coordinates. `path` is a BODY path (`data-mx-ast`). */
interface AnnotationAnchor {
  /** The node's opaque annotation-anchor key. */
  key: string;
  /** Stable source identity. `key` remains as a legacy wire alias. */
  nodeId?: string;
  path: string;
  spanStart: number;
  spanEnd: number;
}

export interface AnnotationWire {
  view_state?: CommentViewState;
  revision?: number;
  /** Set only on an answer to reply+resolve/reopen whose revision was stale: the reply landed, the state change did not. */
  status_conflict?: true;
  image?: CommentImageWire;
  remote_work?:RemoteWork[];
  id: string;
  status: 'open' | 'resolved';
  /** null exactly when `orphaned` — the anchor names nothing in the CURRENT version. */
  anchor: AnnotationAnchor | (HtmlNodeAnchor & { key?: never; path?: never; spanStart?: never; spanEnd?: never }) | null;
  orphaned: boolean;
  /** The document version the comment was made against. */
  anchor_version: number | null;
  /** Plain-text excerpt of what was annotated; survives orphaning. */
  snippet: string;
  /**
   * The words the person actually SELECTED, canonical and stored verbatim —
   * never recomputed, unlike `snippet`, which is the anchored node's text as
   * it reads today. This is what an agent should read. Null on a comment made
   * before the selection was kept, or from a caret with nothing selected.
   */
  quote: string | null;
  /** Where those words were, addressed RELATIVE to the anchor. A hint for repainting, never an identity. */
  range: AnnotationRange | null;
  /**
   * Computed on every read like `orphaned`: are the quoted words still in the
   * document? Null when there is no quote to look for; false when the anchor is
   * present but the selected text has been written away.
   */
  quote_found: boolean | null;
  /** The whole conversation, oldest first — [0] is the annotation's own body. */
  thread: AnnotationCommentWire[];
  created_at: string;
  resolved_at: string | null;
}

export interface CreateAnnotationInput {
  anchor?: HtmlNodeAnchor;
  viewState?: CommentViewState;
  attachmentId?: string;
  /** Stable source identity. */
  nodeId?: string;
  /** The head the page believed in when the owner clicked. */
  baseEditId?: string;
  body: string;
  /** The exact words selected, canonical. Absent for a caret-only comment. */
  quote?: string;
  /** Where they were, relative to the anchor. A quote without one is fine; a range without one is not sent. */
  range?: AnnotationRange;
}

type CreateAnnotationRefusal =
  | { refused: 'not_markup' }
  | { refused: 'bad_path' | 'invalid_attachment' | 'bad_view_state' | 'invalid_annotation_revision' }
  | { refused: 'quote_not_found' | 'ambiguous_quote' }
  /** The document moved under the click — retry with fresh coords (the page is live). */
  | { refused: 'stale'; head: { editId: string; version: number } };

/**
 * A reply's image refused: `stale` when the document moved since the image was staged (the root's
 * stale check), `invalid` when the stage is not this actor's to use (missing, someone else's, used, expired).
 */
export class AnnotationAttachmentError extends Error {
  constructor(readonly reason: 'stale' | 'invalid', readonly head?: string) {
    super(reason === 'stale' ? 'The document changed while you were replying; send again to attach the image.' : 'The image could not be attached; try again.');
  }
}

export class AnnotationRevisionError extends Error {
  constructor(readonly revision:number){super('The annotation changed before this action.');}
}

export interface AnnotationAction {
  expectedRevision?: number;
  reply?: string;
  /** A staged comment image this reply carries, and the revision it was staged against. Only with `reply`. */
  attachmentId?: string;
  attachmentEditId?: string;
  resolve?: boolean;
  reopen?: boolean;
}

/** A comment's new text, optionally conditional on the thread's revision (the ROOT's, the one every reader holds). */
export interface AnnotationEdit {
  body: string;
  expectedRevision?: number;
  /** The editing agent session (AnnotationAuthor.writerSession); none for a person in the browser. */
  writerSession?: string;
}

/** What an edit answers: the thread as it now reads, the edited comment, and the text it replaced (null when unchanged). */
export interface AnnotationEditResult {
  wire: AnnotationWire;
  comment: AnnotationCommentWire;
  previous: string | null;
}

/** ~ how much annotated text survives as the snippet. */

interface AnnotationRowDb {
  revision: number;
  id: string;
  seq: string | number;
  artifact_id: string;
  root_id: string | null;
  body: string;
  author_kind: AnnotationAuthor['kind'];
  author_label: string | null;
  /** Who wrote it, when they had an account — the only thing that can say "your own". */
  author_user_id: string | null;
  author_transport: AnnotationAuthor['transport'];
  author_remote: {sessionId?:string;color?:RemoteColor;harness?:string;avatar_seed?:string}|null;
  /** The author account's picture key, JOINED in the read (`ANNOTATIONS_READ`) — never stored here. */
  author_image_key: string | null;
  status: 'open' | 'resolved';
  resolved_at: string | null;
  anchor_key: string | null;
  html_anchor: HtmlNodeAnchor | null;
  anchor_version: number | null;
  snippet: string;
  created_at: string;
  /** Stored verbatim at create; both null on rows written before the selection was kept. */
  quote: string | null;
  /** JSON `AnnotationRange`, parsed on read — a malformed value reads as no range, never a throw. */
  range: string | null;
  view_state: CommentViewState | null;
  /** Set when the author last rewrote `body`; null on a comment never edited. */
  edited_at: string | null;
}

const scopedRow = async (q: Queryable, scope: Scope, id: string, lock = false): Promise<ArtifactRow | null> => {
  const r = await artifactQuery<ArtifactRow>(q,`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')}${lock ? ' FOR UPDATE' : ''}`, [id, scope.val]);
  return r.rows[0] ?? null;
};

/** The artifact a thread listing is for. `source` is present when the caller already holds the row; otherwise `wireFor` reads it. */
type AnnotatedHead = Pick<ArtifactRow, 'id'> & Partial<Pick<ArtifactRow, 'source' | 'version'>>;

const notify = (q: Queryable, artifactId: string, annotationId: string) =>
  q.query('SELECT pg_notify($1, $2)', [annotationsChannel(artifactId), annotationId]);

/**
 * Every read that builds the wire goes through this relation instead of the
 * bare table: the rows plus their author's picture key, in the SAME statement
 * that fetches the comments — never a lookup per comment. A subquery aliased
 * back to `annotations`, so each reader's WHERE/ORDER stays as written.
 */
/** The credential and agent session a comment change was made with: the events feed marks the reader's own `you`. */
const origin = (actor: AccessActor, session?: string | null): EventOrigin => ({ token_id: actor.tokenId, session: session ?? null });

const ANNOTATIONS_READ =
  '(SELECT a.*, u.image_key AS author_image_key FROM annotations a LEFT JOIN users u ON u.id = a.author_user_id) annotations';

const commentWire = (row: AnnotationRowDb, images: Map<string, CommentImageWire>): AnnotationCommentWire => {
  const kind = row.author_kind === 'agent' ? 'agent' : 'human';
  // Agents are drawn as their product; a token's account says nothing about whose face that is.
  const userId = kind === 'human' ? row.author_user_id : null;
  return {
    id: row.id,
    body: row.body,
    author: {
      kind,
      label: row.author_label,
      ...(row.author_remote??{}),
      transport: row.author_transport,
      user_id: userId,
      image: userId ? avatarUrl({ id: userId, image_key: row.author_image_key }) : null,
    },
    created_at: row.created_at,
    ...(images.has(row.id) ? { image: images.get(row.id) } : {}),
    ...(row.edited_at ? { edited_at: row.edited_at } : {}),
  };
};

interface ReactionRowDb {
  comment_id: string; kind: CommentReactionSummary['kind']; count: string; viewer_reacted: boolean;
  reactors: Array<{ kind: string | null; label: string | null; user_id: string; image_key: string | null }> | null;
}

/**
 * A reactor drawn exactly as `commentWire` draws an author, for the same readers: a person as their account and face,
 * an agent as its label with no account (a token's account says nothing about whose face that is). A row from
 * before reactors were attributed (`reactor_kind` NULL) reads as the account's person.
 */
const reactorWire = (row: NonNullable<ReactionRowDb['reactors']>[number]): CommentReactor => {
  const kind = row.kind === 'agent' ? 'agent' : 'human';
  const userId = kind === 'human' ? row.user_id : null;
  return { kind, label: row.label, user_id: userId, image: userId ? avatarUrl({ id: userId, image_key: row.image_key }) : null };
};

// ── the anchor attribute, read and written against the parsed source ─────────




// ── the quote and its range, answered against the CURRENT source ────────────

/** The stored JSON, or null — a row that cannot be parsed reads as no range, never a throw. */
function storedRange(raw: string | null): AnnotationRange | null {
  if (!raw) return null;
  try {
    return parseAnnotationRange(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function createAnnotationFor(
  actor: AccessActor,
  artifactId: string,
  input: CreateAnnotationInput,
  author: AnnotationAuthor,
  receipt?:MutationReceipt,
): Promise<AnnotationWire | CreateAnnotationRefusal | Response | null> {
  const viewState = input.viewState === undefined ? null : parseCommentViewState(input.viewState);
  if (input.viewState !== undefined && !viewState) return { refused: 'bad_view_state' };
  const db = await getDb();
  const scope = annotationScope(actor);
  const stale = (head: { editId: string; version: number }) => ({ refused: 'stale' as const, head });
  const id = 'ann_' + generateInternalId();
  // Canonical and capped HERE, the one place the columns are written — the
  // door validates the range's grammar, this owns the stored form.
  const quote = input.quote === undefined ? null : canonicalQuote(input.quote) || null;
  const made = await db.transaction(async (tx): Promise<AnnotationWire | CreateAnnotationRefusal | null> => {
    const row = (await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')} FOR UPDATE`, [artifactId, scope.val])).rows[0];
    if (!row) return null;
    if (row.format !== 'html') return { refused: 'not_markup' };
    if (input.baseEditId && input.baseEditId !== row.edit_id) return stale({ editId: row.edit_id, version: row.version });
    const source = row.source ?? '';
    let anchorKey: string | null = null;
    let snippet = '';
    if (row.format === 'html') {
      const anchor = parseHtmlNodeAnchor(input.anchor);
      if (!anchor) return { refused: 'bad_path' };
      if (!/^[0-9]{1,15}$/.test(anchor.revision)) return { refused: 'invalid_annotation_revision' };
      if (anchor.revision !== String(row.version)) return stale({ editId: row.edit_id, version: row.version });
      const resolved = resolveHtmlCommentAnchor(htmlCommentNodes(source), anchor);
      if (!anchor.nodeId || !resolved.node) return { refused: 'bad_path' };
      // Text may be rendered by the page beneath this saved parent. Capture is
      // viewer-supplied evidence, never a claim about authoritative source text.
      if (input.range && (!isAreaRange(input.range) || anchor.quote || anchor.range)) return { refused: 'bad_path' };
      anchorKey = anchor.nodeId;
      snippet = (resolved.node?.text ?? anchor.quote).replace(/\s+/g, ' ').trim().slice(0, 240);
    }
    if (input.attachmentId && (!input.baseEditId || !await consumeCommentImage(tx,actor,artifactId,input.attachmentId,id,row.edit_id))) return {refused:'invalid_attachment'};
    await tx.query(
    `INSERT INTO annotations
       (id, artifact_id, root_id, body, author_kind, author_token_id, author_user_id, author_label, author_transport,
        status, anchor_key, anchor_version, snippet, quote, range, view_state, html_anchor)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $12, $13, $14, $15)`,
    [id, artifactId, input.body, author.kind, actor.tokenId, actor.userId, author.label, author.transport,
      anchorKey, row.version, snippet,
      input.anchor?.quote ?? quote, input.range ? JSON.stringify(input.range) : null, viewState ? JSON.stringify(viewState) : null, input.anchor ? JSON.stringify(input.anchor) : null],
    );
    // Read back through the join, not RETURNING: the echo draws the author's face too.
    const inserted = await tx.query<AnnotationRowDb>(`SELECT * FROM ${ANNOTATIONS_READ} WHERE id = $1`, [id]);
    await recordEvent(tx,actorSubject(actor),'annotated',{kind:'artifact',id:artifactId},{annotation_id:id,agent:author.kind==='agent',via:origin(actor,author.writerSession)});
    await commentMentions(tx,row,actor,input.body,id);
    await notify(tx, artifactId, id);
    const [wire] = await wireFor(tx, row, inserted.rows, actor.userId);
    if(wire&&receipt)await completeMutationReceipt(tx,receipt,{status:201,body:wire as unknown as Record<string,unknown>});
    return wire ?? null;
  }).catch(error=>{if(error instanceof MembershipError)return new Response(JSON.stringify({error:'mention_refused',detail:error.message}),{status:error.status,headers:{'Content-Type':'application/json'}});throw error;});
  if (!made || made instanceof Response || 'refused' in made) return made;
  return made;
}

/**
 * THE DELETE GATE for this table — `annotations.deleted_at IS NULL`, named in
 * every reader below the way lib/artifacts names its own.
 *
 * `deleteAnnotationFor` WRITES the column: a comment is soft-deleted like
 * everything else here, root and replies together, and nothing in this product
 * erases a row. What makes a deleted thread gone is these readers, not a
 * missing row.
 *
 * There is deliberately no restore door for a thread. Taking your words back is
 * meant to read as final to the person who did it; the row is kept because the
 * product keeps every row, not because anything offers it back.
 */
const LIVE_ANNOTATION_SQL = 'deleted_at IS NULL';

/** The current source of a markup document (a row that does not decode reads as empty, like everywhere else). */
async function sourceOf(db: Queryable, id: string): Promise<Pick<ArtifactRow, 'source' | 'version'> | undefined> {
  const r = await artifactQuery<Pick<ArtifactRow, 'source' | 'version'>>(db, 'SELECT version, document, source FROM artifacts WHERE id = $1', [id]);
  return r.rows[0];
}

/** Assemble wire threads for a set of roots — anchors resolved against the CURRENT source. */
async function wireFor(db: Queryable, head: AnnotatedHead, roots: AnnotationRowDb[], viewerId?: string | null): Promise<AnnotationWire[]> {
  if (roots.length === 0) return [];
  const current = head.source !== undefined ? head : await sourceOf(db, head.id);
  const source = current?.source ?? '';
  const rootIds = roots.map((root) => root.id);
  // Batch replies and images across the selected roots.
  const replies = await db.query<AnnotationRowDb>(
    `SELECT * FROM ${ANNOTATIONS_READ} WHERE artifact_id = $1 AND root_id = ANY($2::text[]) AND ${LIVE_ANNOTATION_SQL} ORDER BY seq`,
    [head.id, rootIds],
  );
  const images = await commentImagesFor(db, head.id);
  // ONE statement for every comment's reactions and their reactors: per comment and kind, the exact count, whether
  // the viewer is among them, and the earliest COMMENT_REACTORS_MAX accounts drawn by the author rule (`reactorWire`).
  const reactions = await db.query<ReactionRowDb>(
    `SELECT comment_id, kind, count::text, viewer_reacted, reactors FROM (
       SELECT comment_id, kind, count(*) AS count, bool_or(user_id = $2) AS viewer_reacted,
         json_agg(json_build_object('kind', reactor_kind, 'label', label, 'user_id', user_id, 'image_key', image_key)
           ORDER BY rank) FILTER (WHERE rank <= $3) AS reactors
       FROM (SELECT r.comment_id, r.kind, r.user_id, r.reactor_kind,
               CASE WHEN r.reactor_kind = 'agent' THEN r.reactor_label ELSE coalesce(u.username, r.reactor_label) END AS label, u.image_key,
               row_number() OVER (PARTITION BY r.comment_id, r.kind ORDER BY r.created_at, r.user_id) AS rank
             FROM comment_reactions r LEFT JOIN users u ON u.id = r.user_id WHERE r.comment_id = ANY($1::text[])) ranked
       GROUP BY comment_id, kind) grouped ORDER BY kind`,
    [[...rootIds,...replies.rows.map(reply=>reply.id)],viewerId ?? null,COMMENT_REACTORS_MAX]);
  const reactionMap = new Map<string,CommentReactionSummary[]>();
  for(const reaction of reactions.rows){
    const group=reactionMap.get(reaction.comment_id)??[];
    group.push({kind:reaction.kind,count:Number(reaction.count),viewer_reacted:reaction.viewer_reacted===true,by:(reaction.reactors??[]).map(reactorWire)});
    reactionMap.set(reaction.comment_id,group);
  }
  const withReactions=(row:AnnotationRowDb):AnnotationCommentWire=>({...commentWire(row,images),reactions:reactionMap.get(row.id)??[]});
  const byRoot = new Map<string, AnnotationRowDb[]>();
  for (const r of replies.rows) {
    const list = byRoot.get(r.root_id!) ?? [];
    list.push(r);
    byRoot.set(r.root_id!, list);
  }

  const htmlNodes = roots.some(root => root.html_anchor) ? htmlCommentNodes(source) : null;

  // Reconstruct provenance from immutable snapshots, including anchors saved before
  // this verification rule existed. Never promote an unverified DOM capture when
  // its words happen to appear in a later edit. Batch revisions for the whole page.
  const revisions = [...new Set(roots.map(root => parseHtmlNodeAnchor(root.html_anchor)?.revision).filter((revision): revision is string => !!revision && /^[0-9]{1,15}$/.test(revision)))];
  const captures = new Map<string, ReturnType<typeof htmlCommentNodes>>();
  // Reuse the admitted current source; fetch only distinct historical captures.
  if (htmlNodes && current?.version !== undefined) captures.set(String(current.version), htmlNodes);
  const historical = revisions.filter(revision => !captures.has(revision));
  if (historical.length) {
    const snapshots = await artifactQuery<Pick<ArtifactRow, 'source'> & {version: number}>(db,
      `SELECT version, document, source FROM artifacts WHERE id=$1 AND version::text=ANY($2::text[])
       UNION ALL SELECT version, document, source FROM artifact_versions WHERE artifact_id=$1 AND version::text=ANY($2::text[])`,
      [head.id, historical]);
    for (const snapshot of snapshots.rows) captures.set(String(snapshot.version), htmlCommentNodes(snapshot.source ?? ''));
  }

  return roots.map((root) => {
    const htmlAnchor = parseHtmlNodeAnchor(root.html_anchor);
    const htmlResolved = htmlAnchor && htmlNodes ? resolveHtmlCommentAnchor(htmlNodes, htmlAnchor, captures.get(htmlAnchor.revision) ?? new Map()) : null;
    const anchored = !!htmlResolved?.node;
    const range = storedRange(root.range);
    const viewState = parseCommentViewState(root.view_state);
    return {
      id: root.id,
      revision: root.revision,
      ...(viewState ? { view_state: viewState } : {}),
      ...(images.has(root.id) ? {image:images.get(root.id)} : {}),
      status: root.status,
      anchor: htmlAnchor,
      orphaned: !anchored,
      anchor_version: root.anchor_version,
      snippet: htmlAnchor ? htmlResolved?.node?.text.replace(/\s+/g, ' ').trim().slice(0, 240) ?? root.snippet : root.snippet,
      // Verbatim, both of them: what was selected does not change because the
      // document did — only `quote_found` moves.
      quote: root.quote,
      range,
      quote_found: htmlResolved ? htmlResolved.quoteFound : root.quote === null ? null : false,
      thread: [withReactions(root), ...(byRoot.get(root.id) ?? []).map(withReactions)],
      created_at: root.created_at,
      resolved_at: root.resolved_at,
    };
  });
}

/**
 * List annotations, anchors resolved against the current source. Default
 * lists open only — the inline-on-GET shape; `status: 'all'` includes
 * resolved history.
 */
/** Page only roots; replies for these roots remain one coherent conversation. */
export async function listAnnotationPageFor(actor: AccessActor, artifactId: string,
  opts: {status: 'open' | 'resolved' | 'all'; limit: number; after?: string;author?:string}): Promise<{annotations: AnnotationWire[]; next?: string} | null> {
  const db = await getDb();
  const row = (await readableArtifactHeader(actor, artifactId))?.row;
  if (!row) return null;
  const roots = await db.query<AnnotationRowDb>(
    `SELECT * FROM ${ANNOTATIONS_READ} WHERE artifact_id=$1 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL}
      AND ($2::text='all' OR status=$2) AND ($3::bigint IS NULL OR seq>$3)
      AND ($5::text IS NULL OR author_user_id=$5 OR author_token_id=$5)
      ORDER BY seq LIMIT $4`, [artifactId, opts.status, opts.after ?? null, opts.limit + 1,opts.author??null]);
  const selected = roots.rows.slice(0, opts.limit);
  return {annotations: await wireFor(db, row, selected, actor.userId),
    ...(roots.rows.length > opts.limit ? {next: String(selected.at(-1)!.seq)} : {})};
}

export async function listAnnotationsFor(
  actor: AccessActor,
  artifactId: string,
  opts?: { status?: 'open' | 'resolved' | 'all' },
): Promise<AnnotationWire[] | null> {
  const row = (await readableArtifactHeader(actor, artifactId))?.row;
  if (!row) return null;
  return annotationsWireForRow(row, opts, actor.userId);
}

/**
 * The same listing against a row the caller ALREADY holds — for the surfaces
 * that have done their own ownership check (the artifact GET's inline field,
 * the events route's owner connections). Never call it with a row an ACL has
 * not admitted; the scoping lives in the caller by construction here.
 */
export async function annotationsWireForRow(
  row: AnnotatedHead,
  opts?: { status?: 'open' | 'resolved' | 'all' },
  viewerId?: string | null,
): Promise<AnnotationWire[]> {
  const db = await getDb();
  const status = opts?.status ?? 'open';
  const filter = status === 'all' ? '' : `AND status = '${status === 'open' ? 'open' : 'resolved'}'`;
  const roots = await db.query<AnnotationRowDb>(
    `SELECT * FROM ${ANNOTATIONS_READ} WHERE artifact_id = $1 AND root_id IS NULL ${filter} AND ${LIVE_ANNOTATION_SQL} ORDER BY seq`,
    [row.id],
  );
  return wireFor(db, row, roots.rows, viewerId);
}

/**
 * Reply and/or transition a thread. `{reply, resolve:true}` replies then
 * resolves atomically; `{reopen:true}` clears resolution. Repeating the
 * current state is idempotent. null = unknown annotation or unreachable artifact.
 */
export async function actOnAnnotationFor(
  actor: AccessActor,
  artifactId: string,
  annotationId: string,
  action: AnnotationAction,
  author: AnnotationAuthor,
  receipt?:MutationReceipt,
): Promise<AnnotationWire | null> {
  const db = await getDb();
  const scope = annotationScope(actor);

  /*
   * WHAT MOVED, decided inside the transaction and said outside it. Both
   * sentences are about a state CHANGE, so the flags are set exactly where the
   * writes happen: a reply that was actually inserted, and the one transition
   * the catalogue has a verb for (open → resolved; a reopen says nothing).
   * `emit` may not run in here — PGLite serialises the op queue behind an open
   * transaction — so the callback hands the facts back and the log is told
   * once the transaction has resolved.
   */
  const updated = await db.transaction(async (tx): Promise<{ row: AnnotationRowDb; replied: boolean; resolved: boolean; statusConflict: boolean; wire?:AnnotationWire } | null> => {
    // Artifact → thread order matches root creation and serializes seq allocation through commit.
    const row = await scopedRow(tx, scope, artifactId, true);
    if (!row) return null;
    const found = await tx.query<AnnotationRowDb>(
      `SELECT * FROM annotations WHERE id = $1 AND artifact_id = $2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL} FOR UPDATE`,
      [annotationId, artifactId],
    );
    const root = found.rows[0];
    if (!root) return null;
    /*
     * A reply only APPENDS, so concurrent replies never conflict and a stale `expected_revision` on one is ignored.
     * The optimistic check guards state changes: a bare resolve/reopen against a stale revision throws. A reply
     * combined with a transition keeps the reply (never lose words) and skips the transition, reported as
     * `status_conflict` so the caller re-reads and decides again.
     */
    const stale=action.expectedRevision!==undefined&&root.revision!==action.expectedRevision;
    const hasReply=typeof action.reply==='string'&&action.reply.length>0;
    const transition=Boolean(action.resolve||action.reopen);
    if(stale&&!hasReply)throw new AnnotationRevisionError(root.revision);
    const statusConflict=stale&&transition;

    const replyId='ann_'+generateInternalId();
    const replied = typeof action.reply === 'string' && action.reply.length > 0;
    if (replied) {
      // The reply's image is consumed in the reply's own transaction, exactly as a root's is: single use, the uploader's, unexpired.
      // Checked against the CURRENT head, exactly as a root comment's image is.
      if (action.attachmentId) {
        if (action.attachmentEditId !== row.edit_id) throw new AnnotationAttachmentError('stale', row.edit_id);
        if (!await consumeCommentImage(tx, actor, artifactId, action.attachmentId, replyId, row.edit_id)) throw new AnnotationAttachmentError('invalid');
      }
      await tx.query(
        `INSERT INTO annotations
           (id, artifact_id, root_id, body, author_kind, author_token_id, author_user_id, author_label, author_transport, status, snippet, author_remote)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', '', $10)`,
        [replyId, artifactId, root.id, action.reply, author.kind, actor.tokenId, actor.userId, author.label, author.transport,null],
      );
    }
    if(replied)await commentMentions(tx,row,actor,action.reply!,replyId);
    let resolved = false;
    if (statusConflict) {
      // The thread moved since the caller read it: the reply stands, the state change does not.
    } else if (action.reopen && root.status === 'resolved') {
      await tx.query("UPDATE annotations SET status = 'open', resolved_at = NULL WHERE id = $1", [root.id]);
    } else if (action.resolve && root.status === 'open') {
      await tx.query("UPDATE annotations SET status = 'resolved', resolved_at = now() WHERE id = $1", [root.id]);
      resolved = true;
    }
    if(replied || resolved || (!statusConflict && action.reopen && root.status==='resolved')){
      await tx.query('UPDATE annotations SET revision=revision+1 WHERE id=$1',[root.id]);
      // A reply that also resolved is ONE fact: the reply, with the thread's new state (`resolved: true`).
      await recordEvent(tx,actorSubject(actor),replied?'annotation_replied':resolved?'annotation_resolved':'annotation_reopened',{kind:'artifact',id:artifactId},{annotation_id:root.id,...(replied?{reply_id:replyId,resolved}:{}),agent:author.kind==='agent',via:origin(actor,author.writerSession)});
    }
    const fresh = await tx.query<AnnotationRowDb>(`SELECT * FROM ${ANNOTATIONS_READ} WHERE id = $1`, [root.id]);
    // A vanished row stays the null: wrapping it in the result object would
    // make every miss truthy.
    if (!fresh.rows[0]) return null;
    await notify(tx, artifactId, root.id);
    let wire=receipt?(await wireFor(tx,row,[fresh.rows[0]],actor.userId))[0]:undefined;
    if(wire&&statusConflict)wire={...wire,status_conflict:true};
    if(wire&&receipt)await completeMutationReceipt(tx,receipt,{status:200,body:wire as unknown as Record<string,unknown>});
    return { row: fresh.rows[0], replied, resolved,statusConflict,...(wire?{wire}:{}) };
  });
  if (!updated) return null;

  if(updated.wire)return updated.wire;
  const head = await scopedRow(db, scope, artifactId);
  if (!head) return null;
  const [wire] = await wireFor(db, head, [updated.row], actor.userId);
  return wire ? (updated.statusConflict ? { ...wire, status_conflict: true } : wire) : null;
}

/**
 * Rewrite the TEXT of one comment — a thread's first comment or a reply, open or resolved — by its AUTHOR.
 *
 * EDITING IS NARROWER THAN DELETING. Reaching the document is the editor scope like every annotation verb, and
 * then only the account that wrote the words (`author_user_id`) may change them: a document's owner may take
 * someone's comment away, never put words in their mouth. A comment that is not this actor's is the same uniform
 * null as an unknown id. Anchor, quote, range and image stay as they were; `edited_at` is stamped and no history
 * is kept.
 *
 * The thread's `revision` (the root's) guards the write (a plain reply is never guarded; see actOnAnnotationFor). Repeating the current text changes
 * nothing — no revision, no stamp, no notice — so a retried edit is harmless. Mentions the edit NEWLY adds are
 * invited in this transaction (their notices leave through the event outbox once it commits); the caller tells
 * connected sessions after commit with `previous`.
 */
export async function editAnnotationCommentFor(
  actor: AccessActor,
  artifactId: string,
  commentId: string,
  edit: AnnotationEdit,
  receipt?: MutationReceipt,
): Promise<AnnotationEditResult | null> {
  if (!actor.userId) return null;
  const db = await getDb();
  const scope = annotationScope(actor);
  return db.transaction(async (tx): Promise<AnnotationEditResult | null> => {
    // Artifact → root → reply: the lock order every annotation mutation takes.
    const row = await scopedRow(tx, scope, artifactId, true);
    if (!row) return null;
    const target = await tx.query<{ id: string; root_id: string | null }>(
      `SELECT id, root_id FROM annotations WHERE id = $1 AND artifact_id = $2 AND ${LIVE_ANNOTATION_SQL}`,
      [commentId, artifactId],
    );
    if (!target.rows[0]) return null;
    const rootId = target.rows[0].root_id ?? target.rows[0].id;
    const root = (await tx.query<AnnotationRowDb>(
      `SELECT * FROM annotations WHERE id = $1 AND artifact_id = $2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL} FOR UPDATE`,
      [rootId, artifactId],
    )).rows[0];
    if (!root) return null;
    const comment = target.rows[0].root_id
      ? (await tx.query<AnnotationRowDb>(
        `SELECT * FROM annotations WHERE id = $1 AND artifact_id = $2 AND root_id = $3 AND ${LIVE_ANNOTATION_SQL} FOR UPDATE`,
        [commentId, artifactId, rootId],
      )).rows[0]
      : root;
    if (!comment || comment.author_user_id !== actor.userId) return null;
    if (edit.expectedRevision !== undefined && root.revision !== edit.expectedRevision) throw new AnnotationRevisionError(root.revision);

    const changed = comment.body !== edit.body;
    if (changed) {
      await tx.query('UPDATE annotations SET body = $2, edited_at = now() WHERE id = $1', [comment.id, edit.body]);
      await tx.query('UPDATE annotations SET revision = revision + 1 WHERE id = $1', [root.id]);
      await recordEvent(tx, actorSubject(actor), 'annotation_edited', { kind: 'artifact', id: artifactId }, {
        annotation_id: root.id, ...(comment.id !== root.id ? { reply_id: comment.id } : {}), agent: comment.author_kind === 'agent',
        via: origin(actor, edit.writerSession),
      });
      await commentMentions(tx, row, actor, edit.body, comment.id, comment.body);
      await notify(tx, artifactId, root.id);
    }
    const fresh = await tx.query<AnnotationRowDb>(`SELECT * FROM ${ANNOTATIONS_READ} WHERE id = $1`, [root.id]);
    const [wire] = await wireFor(tx, row, fresh.rows, actor.userId);
    const edited = wire?.thread.find((entry) => entry.id === comment.id);
    if (!wire || !edited) return null;
    if (receipt) await completeMutationReceipt(tx, receipt, { status: 200, body: wire as unknown as Record<string, unknown> });
    return { wire, comment: edited, previous: changed ? comment.body : null };
  });
}

/**
 * Delete one comment, or a whole thread when its root is named. A browser door
 * only: an agent may answer feedback, never take it away.
 *
 * DELETING IS NARROWER THAN COMMENTING. Reaching the document is the editor
 * scope like every other annotation verb, but taking words away is then
 * checked again: the document's OWNER may remove any thread, and a named
 * editor only one they wrote themselves (`author_user_id` on the row). The
 * refusal is the same uniform false as an
 * unknown id, so the door says nothing about whose comment it was.
 *
 * When the last thread on a node goes, its annotation-anchor attribute is
 * cleaned back out of the source — best-effort, through the same edit protocol
 * (a concurrent edit of that node simply wins; a stray attribute is inert).
 */
export async function deleteAnnotationFor(actor: AccessActor, artifactId: string, annotationId: string): Promise<boolean> {
  const db = await getDb();
  const scope = annotationScope(actor);
  const reached = await scopedRow(db, scope, artifactId);
  if (!reached) return false;
  const owner = canGovern(await effectiveRole(reached, actor));

  const cleanup = await db.transaction(async (tx): Promise<{ anchorKey: string | null } | null> => {
    // Artifact → thread order matches root creation and serializes seq allocation through commit.
    const row = await scopedRow(tx, scope, artifactId, true);
    if (!row) return null;
    const target = await tx.query<{ id: string; root_id: string | null }>(
      `SELECT id, root_id FROM annotations WHERE id = $1 AND artifact_id = $2 AND ${LIVE_ANNOTATION_SQL}`,
      [annotationId, artifactId],
    );
    if (!target.rows[0]) return null;
    const rootId = target.rows[0].root_id ?? target.rows[0].id;
    // Every mutation locks the root before a reply. This matches actOnAnnotationFor
    // and serializes deleting a reply against deleting or updating its thread.
    const root = await tx.query<AnnotationRowDb>(
      `SELECT id, anchor_key, author_user_id FROM annotations WHERE id = $1 AND artifact_id = $2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL} FOR UPDATE`,
      [rootId, artifactId],
    );
    if (!root.rows[0]) return null;
    const replyId = target.rows[0].root_id ? target.rows[0].id : undefined;
    const found = replyId
      ? await tx.query<AnnotationRowDb>(
        `SELECT id, root_id, anchor_key, author_user_id FROM annotations WHERE id = $1 AND artifact_id = $2 AND root_id = $3 AND ${LIVE_ANNOTATION_SQL} FOR UPDATE`,
        [replyId, artifactId, rootId],
      )
      : root;
    if (!found.rows[0]) return null;
    // An editor may take back their own words and no one else's.
    if (!owner && (!actor.userId || found.rows[0].author_user_id !== actor.userId)) return null;
    if (replyId) {
      await tx.query('UPDATE annotations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [replyId]);
      await tx.query('UPDATE annotations SET revision = revision + 1 WHERE id = $1 AND deleted_at IS NULL', [rootId]);
    } else {
      // Removing the root removes its replies too: a conversation cannot be
      // left live without its first message.
      await tx.query('UPDATE annotations SET deleted_at = now() WHERE (id = $1 OR root_id = $1) AND deleted_at IS NULL', [rootId]);
    }
    await recordEvent(tx, actorSubject(actor), 'annotation_deleted', { kind: 'artifact', id: artifactId }, {
      annotation_id: rootId, ...(replyId ? { reply_id: replyId } : {}), via: origin(actor),
    });
    await notify(tx, artifactId, rootId);
    if (replyId) return { anchorKey: null };
    const anchorKey = root.rows[0].anchor_key;
    if (!anchorKey) return { anchorKey: null };
    const others = await tx.query(`SELECT 1 FROM annotations WHERE artifact_id = $1 AND anchor_key = $2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL}`, [artifactId, anchorKey]);
    return { anchorKey: others.rows.length === 0 ? anchorKey : null };
  });
  if (!cleanup) return false;
  // A cleanup is only produced when the UPDATE ran, so this is the deletion
  // itself rather than an attempt at one. Said before the anchor is swept out
  // of the source, which is a document edit with a verb of its own.

  return true;
}

/** Open-annotation count for write echoes (PUT/edits) — the write path stays annotation-free. */
export async function countOpenAnnotations(artifactId: string): Promise<number> {
  const db = await getDb();
  const r = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM annotations WHERE artifact_id = $1 AND root_id IS NULL AND status = 'open' AND ${LIVE_ANNOTATION_SQL}`,
    [artifactId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Desired per-account/per-kind state. Artifact→root locks serialize against deletion and all comment mutations.
 *
 * An effective change (not a repeat of the current state) records one `annotation_reaction_changed` fact through the
 * outbox, in this transaction: the public events feed's reaction event (lib/event-feed), with the count right after.
 * `reactor` is decided at the door, as a comment's author is: a browser session is the person, a bearer an agent.
 */
export async function setCommentReactionFor(actor:AccessActor,artifactId:string,commentId:string,input:CommentReactionInput,reactor:Pick<AnnotationAuthor,'kind'|'label'|'writerSession'>):Promise<AnnotationWire|null>{
  if(!actor.userId)return null;
  const db=await getDb();
  return db.transaction(async tx=>{
    const row=await scopedRow(tx,reactionScope(actor),artifactId,true);
    if(!row || row.format!=='html')return null;
    const target=(await tx.query<{id:string;root_id:string|null}>(`SELECT id,root_id FROM annotations WHERE id=$1 AND artifact_id=$2 AND ${LIVE_ANNOTATION_SQL}`,[commentId,artifactId])).rows[0];
    if(!target)return null;
    const rootId=target.root_id??target.id;
    const root=(await tx.query<AnnotationRowDb>(`SELECT * FROM annotations WHERE id=$1 AND artifact_id=$2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL} FOR UPDATE`,[rootId,artifactId])).rows[0];
    if(!root)return null;
    const result=input.active
      ?await tx.query('INSERT INTO comment_reactions (comment_id,user_id,kind,reactor_kind,reactor_label) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING comment_id',[commentId,actor.userId,input.kind,reactor.kind,reactor.label])
      :await tx.query('DELETE FROM comment_reactions WHERE comment_id=$1 AND user_id=$2 AND kind=$3 RETURNING comment_id',[commentId,actor.userId,input.kind]);
    if(result.rows.length){
      const count=Number((await tx.query<{n:string|number}>('SELECT count(*) AS n FROM comment_reactions WHERE comment_id=$1 AND kind=$2',[commentId,input.kind])).rows[0]?.n??0);
      await recordEvent(tx,actorSubject(actor),'annotation_reaction_changed',{kind:'artifact',id:artifactId},{
        annotation_id:rootId,...(commentId!==rootId?{reply_id:commentId}:{}),kind:input.kind,active:input.active,count,
        agent:reactor.kind==='agent',via:origin(actor,reactor.writerSession)});
      await notify(tx,artifactId,rootId);
    }
    const fresh=(await tx.query<AnnotationRowDb>(`SELECT * FROM ${ANNOTATIONS_READ} WHERE id=$1`,[rootId])).rows;
    return (await wireFor(tx,row,fresh,actor.userId))[0]??null;
  });
}
