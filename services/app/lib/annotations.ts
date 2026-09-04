/**
 * ANNOTATIONS — human/agent comments pinned to nodes of a document. The ONLY reader/writer of the
 * `annotations` table.
 *
 * THE ANCHOR IS IN THE DOCUMENT: the first comment on a node stamps a
 * `data-annotation-anchor="<key>"` attribute into its opening tag — as a REAL
 * EDIT through `applyEditFor`, so the concurrent-edit CAS, the conflict check (the touched
 * span is the node, so it collides only with a concurrent edit of that same
 * node), version bumping, the live stream and revert all treat it as the
 * ordinary write it is. The thread rows stay SIDECAR (replying and resolving
 * never touch the document); only the anchor lives in the source, where an
 * agent editing the markup can see it, keep it, and move it with the content.
 *
 * RESOLUTION is a lookup, not a replay: parse the CURRENT source, find the
 * element whose annotation-anchor key matches. Present → anchored (path and
 * span derived fresh, in whatever version the document is at). Absent → orphaned — and
 * orphaned is COMPUTED PER READ, never a tombstone: a revert that brings the
 * text back re-anchors the thread by itself.
 *
 * COORDINATE NOTE (the Helmet-offset lesson): the wire and the frame speak
 * BODY paths; the source counts from the top. Capture translates body → source
 * (`bodyPathToSourcePath`); listing translates the found node's source path
 * back (`sourcePathToBodyPath`). Nothing in between converts.
 */
import {
  annotationScope, applyEditFor, effectiveRole,
  type ArtifactRow, type Scope, type TokenActor,
} from '@/lib/artifacts';
import { canGovern } from '@/lib/share-roles';
import { ANNOTATION_ANCHOR_ATTR } from '@/lib/annotation-anchors';
import { getDb, type Queryable } from '@/lib/db';
import { generateInternalId } from '@/lib/ids';
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import {
  canonicalQuote, canonicalText, parseAnnotationRange, parseRel,
  type AnnotationRange,
} from '@/lib/story/annotation-range';
import { bodyPathToSourcePath, sourcePathToBodyPath } from '@/lib/story/edit-compose';
import { channelForAnnotations } from '@/lib/story/live';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';

/**
 * The attribute that ties a node to its threads. It stores an opaque key, never
 * comment text. It lives in a PURE module (lib/annotation-anchors) because the
 * fork door has to strip anchors from a document's source and may not import
 * this one — which imports lib/artifacts.
 */
export { ANNOTATION_ANCHOR_ATTR };

/** Where an annotation points, in CURRENT head coordinates. `path` is a BODY path (`data-mx-ast`). */
export interface AnnotationAnchor {
  /** The node's opaque annotation-anchor key. */
  key: string;
  path: string;
  spanStart: number;
  spanEnd: number;
}

/** Who wrote a comment. Ownership is an ACL relationship, not an author kind. */
export interface AnnotationAuthor {
  kind: 'human' | 'agent';
  /** Display snapshot (username, token name…); stored beside the row so reads never join. */
  label: string | null;
  /** How this individual comment arrived; stored per comment because one token can use several transports. */
  transport: 'browser' | 'http' | 'mcp' | 'unknown';
}

export interface AnnotationCommentWire {
  id: string;
  body: string;
  author: AnnotationAuthor;
  created_at: string;
}

export interface AnnotationWire {
  id: string;
  status: 'open' | 'resolved';
  /** null exactly when `orphaned` — the anchor names nothing in the CURRENT version. */
  anchor: AnnotationAnchor | null;
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
  /** BODY path the frame reported for the selected node. */
  bodyPath: string;
  /** The head the page believed in when the owner clicked. */
  baseEditId: string;
  body: string;
  /** The exact words selected, canonical. Absent for a caret-only comment. */
  quote?: string;
  /** Where they were, relative to the anchor. A quote without one is fine; a range without one is not sent. */
  range?: AnnotationRange;
}

export type CreateAnnotationRefusal =
  | { refused: 'not_markup' }
  | { refused: 'bad_path' }
  /** The document moved under the click — retry with fresh coords (the page is live). */
  | { refused: 'stale'; head: { editId: string; version: number } };

export interface AnnotationAction {
  reply?: string;
  resolve?: boolean;
  reopen?: boolean;
}

/** ~ how much annotated text survives as the snippet. */
export const ANNOTATION_SNIPPET_MAX = 200;

interface AnnotationRowDb {
  id: string;
  seq: string | number;
  artifact_id: string;
  root_id: string | null;
  body: string;
  /** `owner` is accepted only for rows written before the human/agent contract. */
  author_kind: 'owner' | AnnotationAuthor['kind'];
  author_label: string | null;
  /** Who wrote it, when they had an account — the only thing that can say "your own". */
  author_user_id: string | null;
  author_transport: AnnotationAuthor['transport'];
  status: 'open' | 'resolved';
  resolved_at: string | null;
  anchor_key: string | null;
  anchor_version: number | null;
  snippet: string;
  created_at: string;
  /** Stored verbatim at create; both null on rows written before the selection was kept. */
  quote: string | null;
  /** JSON `AnnotationRange`, parsed on read — a malformed value reads as no range, never a throw. */
  range: string | null;
}

const scopedRow = async (q: Queryable, scope: Scope, id: string): Promise<ArtifactRow | null> => {
  const r = await q.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
  return r.rows[0] ?? null;
};

/** Markup slice → plain text: tags out, whitespace collapsed, capped. */
const snippetOf = (markup: string): string =>
  markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ANNOTATION_SNIPPET_MAX);

const notify = (q: Queryable, artifactId: string, annotationId: string) =>
  q.query('SELECT pg_notify($1, $2)', [channelForAnnotations(artifactId), annotationId]);

const commentWire = (row: AnnotationRowDb): AnnotationCommentWire => ({
  id: row.id,
  body: row.body,
  author: {
    kind: row.author_kind === 'agent' ? 'agent' : 'human',
    label: row.author_label,
    transport: row.author_transport,
  },
  created_at: row.created_at,
});

// ── the anchor attribute, read and written against the parsed source ─────────

const anchorKeyOf = (node: JsxElement): string | null => {
  const attr = node.attributes.find((a) => a.name === ANNOTATION_ANCHOR_ATTR);
  return attr && attr.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};

/**
 * An anchored node as the source knows it: the element, its SOURCE path, and
 * the sibling list it sits in — a range part addressed `+1` names the anchor's
 * next ELEMENT sibling, which cannot be reached from the node alone.
 */
interface AnchorEntry {
  node: JsxElement;
  path: string;
  siblings: JsxNode[];
}

/** Every anchor-carrying element in the source, by key, with its SOURCE path. */
function anchorIndex(source: string): Map<string, AnchorEntry> {
  const out = new Map<string, AnchorEntry>();
  const parsed = parseJsx(source);
  if (!parsed.ok) return out;
  const walk = (nodes: JsxNode[], prefix: string) => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type !== 'element') continue;
      const path = prefix ? `${prefix}.${i}` : String(i);
      // First occurrence wins: a duplicated attribute (an agent copied the
      // node) must not make the anchor jump between copies read to read.
      const key = anchorKeyOf(node);
      if (key && !out.has(key)) out.set(key, { node, path, siblings: nodes });
      walk(node.children, path);
    }
  };
  walk(parsed.nodes, '');
  return out;
}

/** The source with ` data-annotation-anchor="<key>"` spliced into the node's opening tag. */
const sourceWithAnchor = (source: string, node: JsxElement, anchorKey: string): string => {
  const at = node.start + 1 + node.tag.length;
  return source.slice(0, at) + ` ${ANNOTATION_ANCHOR_ATTR}="${anchorKey}"` + source.slice(at);
};

/** The source with one anchor attribute removed (including its leading space). */
const sourceWithoutAnchor = (source: string, node: JsxElement): string => {
  const attr = node.attributes.find((a) => a.name === ANNOTATION_ANCHOR_ATTR);
  if (!attr) return source;
  const from = source[attr.start - 1] === ' ' ? attr.start - 1 : attr.start;
  return source.slice(0, from) + source.slice(attr.end);
};

// ── the quote and its range, answered against the CURRENT source ────────────

/**
 * An element's visible text in the ONE canonical form the frame captured the
 * quote in. Concatenated with NO separator, because that is what the DOM's
 * `textContent` does: `a<b>x</b>c` reads `axc`, and a joiner here would make
 * every re-find across an inline element fail.
 */
function canonicalTextOf(node: JsxNode): string {
  const raw = (n: JsxNode): string =>
    n.type === 'text' ? n.value : n.type === 'element' ? n.children.map(raw).join('') : '';
  return canonicalText(raw(node));
}

/** ELEMENT children only — `rel` counts elements, never the text between them. */
const elementChildrenOf = (nodes: JsxNode[]): JsxElement[] =>
  nodes.filter((n): n is JsxElement => n.type === 'element');

/** Walk a part's `rel` from the anchored element to the node it names. */
function nodeForRel(entry: AnchorEntry, rel: string): JsxElement | null {
  const address = parseRel(rel);
  if (!address) return null;
  let node: JsxElement | undefined = entry.node;
  if (address.sibling > 0) {
    const siblings = elementChildrenOf(entry.siblings);
    node = siblings[siblings.indexOf(entry.node) + address.sibling];
  }
  for (const step of address.steps) {
    if (!node) return null;
    node = elementChildrenOf(node.children)[step];
  }
  return node ?? null;
}

/** The stored JSON, or null — a row that cannot be parsed reads as no range, never a throw. */
function storedRange(raw: string | null): AnnotationRange | null {
  if (!raw) return null;
  try {
    return parseAnnotationRange(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Are the quoted words still there? Computed per read, like `orphaned`, and
 * never written back: the quote is what was selected, and this says whether
 * the document still says it. EVERY part, not any: half a quote is not the
 * words the person selected, and an agent reading `quote_found: true` must be
 * able to trust that what it is answering is still on the page. A quote with no
 * range can only be answered by whether the anchor survived — there is nothing
 * to look for.
 */
function quoteFound(entry: AnchorEntry | undefined, quote: string | null, range: AnnotationRange | null): boolean | null {
  if (quote === null) return null;
  if (!entry) return false;
  if (!range) return true;
  return range.parts.every((part) => {
    const node = nodeForRel(entry, part.rel);
    return !!node && canonicalTextOf(node).includes(part.text);
  });
}

/**
 * Create an annotation on a node of the owner's document. When the node has
 * no annotation anchor yet, stamping one is a REAL EDIT against the base the
 * caller named — every protocol answer (stale head, node conflict) surfaces as the
 * `stale` refusal so the live page retries with fresh coordinates.
 */
export async function createAnnotationFor(
  actor: TokenActor,
  artifactId: string,
  input: CreateAnnotationInput,
  author: AnnotationAuthor,
): Promise<AnnotationWire | CreateAnnotationRefusal | Response | null> {
  const db = await getDb();
  const scope = annotationScope(actor);
  const row = await scopedRow(db, scope, artifactId);
  if (!row) return null;
  if (row.format !== 'markup') return { refused: 'not_markup' };
  const stale = (head: { editId: string; version: number }) => ({ refused: 'stale' as const, head });
  if (input.baseEditId !== row.edit_id) return stale({ editId: row.edit_id, version: row.version });

  const source = row.source ?? '';
  const parsed = parseJsx(source);
  if (!parsed.ok) return { refused: 'bad_path' };
  const node = resolveJsxNodeAtPath(parsed.nodes, bodyPathToSourcePath(source, input.bodyPath));
  if (!node || node.type !== 'element') return { refused: 'bad_path' };

  let anchorKey = anchorKeyOf(node);
  let head = { version: row.version, editId: row.edit_id };
  if (!anchorKey) {
    anchorKey = 'a' + generateInternalId().slice(0, 8);
    const outcome = await applyEditFor(actor, artifactId, {
      baseEditId: input.baseEditId,
      change: { newSource: sourceWithAnchor(source, node, anchorKey) },
    }, { scope });
    if (!outcome) return null;
    // The anchor is a real document edit, so the ordinary publish pipeline may
    // refuse the document (for example, an older artifact that no longer
    // satisfies today's validator). Preserve that named refusal verbatim.
    // Calling it `bad_path` hid the only useful diagnostic and blamed a path
    // that had already resolved successfully above.
    if (outcome instanceof Response) return outcome;
    if (!outcome.applied) {
      const moved = 'head' in outcome ? { editId: outcome.head.editId, version: outcome.head.version } : { editId: row.edit_id, version: row.version };
      return stale(moved);
    }
    head = { version: outcome.row.version, editId: outcome.row.edit_id };
  }

  const id = 'ann_' + generateInternalId();
  // Canonical and capped HERE, the one place the columns are written — the
  // door validates the range's grammar, this owns the stored form.
  const quote = input.quote === undefined ? null : canonicalQuote(input.quote) || null;
  const inserted = await db.query<AnnotationRowDb>(
    `INSERT INTO annotations
       (id, artifact_id, root_id, body, author_kind, author_token_id, author_user_id, author_label, author_transport,
        status, anchor_key, anchor_version, snippet, quote, range)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $12, $13)
     RETURNING *`,
    [id, artifactId, input.body, author.kind, actor.tokenId, actor.userId, author.label, author.transport,
      anchorKey, head.version, snippetOf(source.slice(node.start, node.end)),
      quote, input.range ? JSON.stringify(input.range) : null],
  );
  await notify(db, artifactId, id);

  const fresh = await scopedRow(db, scope, artifactId);
  const [wire] = fresh ? await wireFor(db, fresh, inserted.rows) : [];
  return wire ?? null;
}

/**
 * THE TRASH GATE for this table — `annotations.deleted_at IS NULL`, named in
 * every reader below the way lib/artifacts names its own.
 *
 * `deleteAnnotationFor` is still a HARD delete and nothing writes the column
 * today: erasing someone's words is a deliberate act with no restore door
 * behind it, so a comment does not go to a trash. The column and this gate are
 * what the pattern owes an adopted table — they make a row that carries the
 * stamp invisible, so adopting it for real is one statement rather than an
 * audit of every reader.
 */
const LIVE_ANNOTATION_SQL = 'deleted_at IS NULL';

/** Assemble wire threads for a set of roots — anchors resolved against the CURRENT source. */
async function wireFor(db: Queryable, head: ArtifactRow, roots: AnnotationRowDb[]): Promise<AnnotationWire[]> {
  if (roots.length === 0) return [];
  const replies = await db.query<AnnotationRowDb>(
    `SELECT * FROM annotations WHERE artifact_id = $1 AND root_id IS NOT NULL AND ${LIVE_ANNOTATION_SQL} ORDER BY seq`,
    [head.id],
  );
  const byRoot = new Map<string, AnnotationRowDb[]>();
  for (const r of replies.rows) {
    const list = byRoot.get(r.root_id!) ?? [];
    list.push(r);
    byRoot.set(r.root_id!, list);
  }

  const source = head.source ?? '';
  const anchors = anchorIndex(source);

  return roots.map((root) => {
    const found = root.anchor_key ? anchors.get(root.anchor_key) : undefined;
    const bodyPath = found ? sourcePathToBodyPath(source, found.path) : null;
    const anchored = !!found && bodyPath !== null;
    const range = storedRange(root.range);
    return {
      id: root.id,
      status: root.status,
      anchor: anchored
        ? { key: root.anchor_key!, path: bodyPath!, spanStart: found.node.start, spanEnd: found.node.end }
        : null,
      orphaned: !anchored,
      anchor_version: root.anchor_version,
      snippet: anchored ? snippetOf(source.slice(found.node.start, found.node.end)) : root.snippet,
      // Verbatim, both of them: what was selected does not change because the
      // document did — only `quote_found` moves.
      quote: root.quote,
      range,
      quote_found: quoteFound(anchored ? found : undefined, root.quote, range),
      thread: [commentWire(root), ...(byRoot.get(root.id) ?? []).map(commentWire)],
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
export async function listAnnotationsFor(
  actor: TokenActor,
  artifactId: string,
  opts?: { status?: 'open' | 'resolved' | 'all' },
): Promise<AnnotationWire[] | null> {
  const db = await getDb();
  const row = await scopedRow(db, annotationScope(actor), artifactId);
  if (!row) return null;
  return annotationsWireForRow(row, opts);
}

/**
 * The same listing against a row the caller ALREADY holds — for the surfaces
 * that have done their own ownership check (the artifact GET's inline field,
 * the events route's owner connections). Never call it with a row an ACL has
 * not admitted; the scoping lives in the caller by construction here.
 */
export async function annotationsWireForRow(
  row: ArtifactRow,
  opts?: { status?: 'open' | 'resolved' | 'all' },
): Promise<AnnotationWire[]> {
  const db = await getDb();
  const status = opts?.status ?? 'open';
  const filter = status === 'all' ? '' : `AND status = '${status === 'open' ? 'open' : 'resolved'}'`;
  const roots = await db.query<AnnotationRowDb>(
    `SELECT * FROM annotations WHERE artifact_id = $1 AND root_id IS NULL ${filter} AND ${LIVE_ANNOTATION_SQL} ORDER BY seq`,
    [row.id],
  );
  return wireFor(db, row, roots.rows);
}

/**
 * Reply and/or transition a thread. `{reply, resolve:true}` replies then
 * resolves atomically; `{reopen:true}` clears resolution. Repeating the
 * current state is idempotent. null = unknown annotation or unreachable artifact.
 */
export async function actOnAnnotationFor(
  actor: TokenActor,
  artifactId: string,
  annotationId: string,
  action: AnnotationAction,
  author: AnnotationAuthor,
): Promise<AnnotationWire | null> {
  const db = await getDb();
  const scope = annotationScope(actor);

  const updated = await db.transaction(async (tx): Promise<AnnotationRowDb | null> => {
    const row = await scopedRow(tx, scope, artifactId);
    if (!row) return null;
    const found = await tx.query<AnnotationRowDb>(
      `SELECT * FROM annotations WHERE id = $1 AND artifact_id = $2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL}`,
      [annotationId, artifactId],
    );
    const root = found.rows[0];
    if (!root) return null;

    if (typeof action.reply === 'string' && action.reply.length > 0) {
      await tx.query(
        `INSERT INTO annotations
           (id, artifact_id, root_id, body, author_kind, author_token_id, author_user_id, author_label, author_transport, status, snippet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', '')`,
        ['ann_' + generateInternalId(), artifactId, root.id, action.reply, author.kind, actor.tokenId, actor.userId, author.label, author.transport],
      );
    }
    if (action.reopen && root.status === 'resolved') {
      await tx.query("UPDATE annotations SET status = 'open', resolved_at = NULL WHERE id = $1", [root.id]);
    } else if (action.resolve && root.status === 'open') {
      await tx.query("UPDATE annotations SET status = 'resolved', resolved_at = now() WHERE id = $1", [root.id]);
    }
    const fresh = await tx.query<AnnotationRowDb>('SELECT * FROM annotations WHERE id = $1', [root.id]);
    await notify(tx, artifactId, root.id);
    return fresh.rows[0];
  });
  if (!updated) return null;

  const head = await scopedRow(db, scope, artifactId);
  if (!head) return null;
  const [wire] = await wireFor(db, head, [updated]);
  return wire ?? null;
}

/**
 * Delete a thread outright — root and replies. A browser door only: an agent
 * may answer feedback, never erase it.
 *
 * ERASING IS NARROWER THAN COMMENTING. Reaching the document is the editor
 * scope like every other annotation verb, but taking words away is then
 * checked again: the document's OWNER may remove any thread, and a named
 * editor only one they wrote themselves (`author_user_id`, already on the row —
 * this needed no schema change). The refusal is the same uniform false as an
 * unknown id, so the door says nothing about whose comment it was.
 *
 * When the last thread on a node goes, its annotation-anchor attribute is
 * cleaned back out of the source — best-effort, through the same edit protocol
 * (a concurrent edit of that node simply wins; a stray attribute is inert).
 */
export async function deleteAnnotationFor(actor: TokenActor, artifactId: string, annotationId: string): Promise<boolean> {
  const db = await getDb();
  const scope = annotationScope(actor);
  const reached = await scopedRow(db, scope, artifactId);
  if (!reached) return false;
  const owner = canGovern(await effectiveRole(reached, actor));

  const cleanup = await db.transaction(async (tx): Promise<{ anchorKey: string | null } | null> => {
    const row = await scopedRow(tx, scope, artifactId);
    if (!row) return null;
    const found = await tx.query<AnnotationRowDb>(
      `SELECT anchor_key, author_user_id FROM annotations WHERE id = $1 AND artifact_id = $2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL}`,
      [annotationId, artifactId],
    );
    if (found.rows.length === 0) return null;
    // An editor may take back their own words and no one else's.
    if (!owner && (!actor.userId || found.rows[0].author_user_id !== actor.userId)) return null;
    await tx.query('DELETE FROM annotations WHERE id = $1 OR root_id = $1', [annotationId]);
    const anchorKey = found.rows[0].anchor_key;
    if (!anchorKey) return { anchorKey: null };
    const others = await tx.query(`SELECT 1 FROM annotations WHERE artifact_id = $1 AND anchor_key = $2 AND root_id IS NULL AND ${LIVE_ANNOTATION_SQL}`, [artifactId, anchorKey]);
    await notify(tx, artifactId, annotationId);
    return { anchorKey: others.rows.length === 0 ? anchorKey : null };
  });
  if (!cleanup) return false;

  if (cleanup.anchorKey) {
    const head = await scopedRow(db, scope, artifactId);
    const source = head?.source ?? '';
    const found = head ? anchorIndex(source).get(cleanup.anchorKey) : undefined;
    if (head && found) {
      await applyEditFor(actor, artifactId, {
        baseEditId: head.edit_id,
        change: { newSource: sourceWithoutAnchor(source, found.node) },
      }).catch(() => {});
    }
  }
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
