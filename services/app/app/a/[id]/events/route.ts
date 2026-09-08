/**
 * GET /a/:id/events — Server-Sent Events carrying this artifact's document
 * as it changes, so an open page (viewing OR editing) stays live.
 *
 * A sub-path of the one shareable URL, like ./raw and ./export. Anyone who
 * may read the page may watch it change — it reveals nothing a reload would
 * not.
 *
 * The transport is the minusx chat-stream pattern: a NOTIFY is only a wakeup
 * pointer, and every wakeup does a catch-up SELECT, so a missed notification
 * costs nothing. The first frame is always the current state, which makes the
 * stream self-syncing — a client that connects late, reconnects, or misses a
 * wakeup converges on the next event with no cursor bookkeeping.
 */
import { trackEvent } from '@/lib/analytics';
import { canReadArtifact, datasetsForDocument, getArtifactById } from '@/lib/artifacts';
import { isDocumentFormat } from '@/lib/story/input';
import { isOwner, roleFor, sessionActor } from '@/lib/viewer';
import { canAnnotate } from '@/lib/share-roles';
import { authorHandle } from '@/lib/users';
import { ID_RE } from '@/lib/ids';
import { subscribeToAnnotations, subscribeToArtifact, TooManyLiveChannels, type ArtifactDataEvent, type ArtifactVersionPing } from '@/lib/story/live';
import { STORY_ANNOTATIONS_EVENT, STORY_DATA_EVENT } from '@/lib/story-runtime/contract';

/** Browsers reconnect an idle EventSource; a comment frame keeps proxies from closing it. */
const KEEPALIVE_MS = 15_000;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response('not found', { status: 404 });
  const initial = await getArtifactById(id);
  if (!initial) return new Response('not found', { status: 404 });
  // Same uniform 404 as ./raw — and the same VIEWER as ./raw and the proxy
  // (sessionActor: NextAuth, then the agent cookie), or an anonymous owner's
  // live stream would drop the moment their doc went beyond public.
  const actor = await sessionActor(request);
  const viewer = actor.viewer;
  if (!(await canReadArtifact(initial, viewer))) return new Response('not found', { status: 404 });
  // Annotations are OWNER-state (either browser credential — the account
  // owner, or the anonymous agent-cookie owner), decided once here and
  // re-checked on every wakeup like the ACL.
  const ownerConnection = isOwner(initial, actor);
  // Annotations are narrated to everyone who may write them: the owner, an editor, a commenter.
  const annotatorConnection = ownerConnection || canAnnotate(await roleFor(initial, actor));
  const artifactId = initial.id;
  // Connect only — never in the wakeup loop, which fires per remote edit.
  void trackEvent('sse_connect', artifactId, { userId: viewer?.userId ?? null });

  /**
   * THE DOCUMENT'S DATASETS, WATCHED BESIDE THE DOCUMENT ITSELF.
   *
   * A dataset write is a version on the DATASET's row and a NOTIFY on the
   * DATASET's channel (lib/story/dataset-mutate) — nothing about the document
   * changes, so the stream above would never mention it and every chart built
   * on that data would sit stale until someone reloaded. So this stream also
   * listens on each dataset the document reads or writes, and forwards a small
   * `data` frame naming it; the runtime re-runs exactly the queries that read
   * it (lib/story/dataflow queriesReadingDatasets).
   *
   * A separate SSE EVENT NAME, deliberately: the default `message` frame is
   * the whole document and is guarded by `editId`/`version` at both ends, and
   * a data wakeup carries neither. Old clients ignore an unknown event name,
   * so this is additive on the wire.
   *
   * The set follows the DOCUMENT: an edit can add or drop a `<Query>`, so it
   * is re-derived on every document frame and the subscriptions are adjusted.
   */
  const datasetUnsubs = new Map<string, () => Promise<void>>();

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  let unsubscribe: (() => Promise<void>) | undefined;

  const send = (event: ArtifactVersionPing) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => { /* client gone */ });

  /** A DATA wakeup: this dataset changed, re-run what reads it. */
  const sendData = (event: ArtifactDataEvent) =>
    writer.write(encoder.encode(`event: ${STORY_DATA_EVENT}\ndata: ${JSON.stringify(event)}\n\n`)).catch(() => { /* client gone */ });

  /**
   * ANNOTATIONS, FOR AN ANNOTATOR'S CONNECTION ONLY. The stream serves plain
   * readers too, and a reader is never told that a conversation exists — so
   * the named frame exists only on a connection whose credential could
   * annotate (owner, editor, commenter), re-checked with the ACL on every
   * wakeup, which is what makes a demotion stop the narration rather than
   * merely stop the next one.
   */
  // A PING and nothing else — the annotator's page refetches the list, which
  // is the blind-relay rule: what travels is that something moved, never what
  // it says. Listing also advances the stored anchors, so a document wakeup
  // keeps pin paths current with the edit that just landed.
  const sendAnnotations = () =>
    writer.write(encoder.encode(`event: ${STORY_ANNOTATIONS_EVENT}\ndata: {}\n\n`)).catch(() => { /* client gone */ });

  const pushAnnotations = async () => {
    if (closed || !annotatorConnection) return;
    const row = await getArtifactById(id);
    if (!row) return void close();
    if (!(await canReadArtifact(row, viewer))) return void close();
    if (!isOwner(row, actor) && !canAnnotate(await roleFor(row, actor))) return; // demoted mid-stream: stop narrating, keep the document
    void sendAnnotations();
  };

  let annotationsUnsub: (() => Promise<void>) | undefined;

  const keepalive = setInterval(() => {
    writer.write(encoder.encode(': ping\n\n')).catch(() => { /* client gone */ });
  }, KEEPALIVE_MS);

  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    if (unsubscribe) await unsubscribe().catch(() => {});
    if (annotationsUnsub) await annotationsUnsub().catch(() => {});
    for (const drop of datasetUnsubs.values()) await drop().catch(() => {});
    datasetUnsubs.clear();
    await writer.close().catch(() => {});
  };

  /**
   * A dataset wakeup. The document's own ACL is re-checked here exactly as it
   * is for a document frame — a stream is long-lived and access is not — and
   * the payload is deliberately tiny: which dataset, and the version it
   * reached. The rows themselves come from the query endpoint, under the same
   * ACL as everything else, so this frame reveals nothing a reader could not
   * already fetch.
   */
  const wakeDataset = async (datasetId: string) => {
    if (closed) return;
    const row = await getArtifactById(id);
    if (!row) return void close();
    if (!(await canReadArtifact(row, viewer))) return void close();
    const dataset = await getArtifactById(datasetId);
    void sendData({ datasets: [datasetId], version: dataset?.version ?? 0 });
  };

  /**
   * Follow exactly the datasets this version of the row depends on.
   *
   * A FOLDER DEPENDS ON ITSELF, and that rule is stated here rather than
   * inferred from its stored source. It used to be inferred: a folder's source
   * was a scaffold naming `ref_<own id>`, so `datasetsForDocument` returned its
   * own id and a child write — which NOTIFYs the parent's channel (lib/folders
   * notifyParent) — arrived as an ordinary `data` frame. A folder has no source
   * now, so nothing would name it, and an open listing would sit stale until
   * someone reloaded. The wire is unchanged: the same `event: data` frame
   * naming the same id, so the folder page and an authored `<Files>` document
   * both re-read on exactly the ping they already read on.
   */
  const followDatasets = async (row: { format: string; id: string; source: string | null }) => {
    if (closed) return;
    const wanted = new Set(row.format === 'folder' ? [row.id] : datasetsForDocument(isDocumentFormat(row.format) ? row.source : null));
    for (const [datasetId, drop] of datasetUnsubs) {
      if (wanted.has(datasetId)) continue;
      datasetUnsubs.delete(datasetId);
      await drop().catch(() => {});
    }
    for (const datasetId of wanted) {
      if (datasetUnsubs.has(datasetId)) continue;
      try {
        // Reserve the slot before awaiting, so two frames arriving together
        // cannot open two subscriptions to the same channel.
        datasetUnsubs.set(datasetId, async () => {});
        const drop = await subscribeToArtifact(datasetId, () => void wakeDataset(datasetId));
        if (closed) { await drop().catch(() => {}); datasetUnsubs.delete(datasetId); return; }
        datasetUnsubs.set(datasetId, drop);
      } catch (error) {
        // At capacity: the document itself still streams. Data updates then
        // arrive on the reader's next interaction rather than on their own.
        datasetUnsubs.delete(datasetId);
        if (!(error instanceof TooManyLiveChannels)) throw error;
      }
    }
  };

  // Last stylesheet sent on THIS connection, so repeats can be skipped.
  let lastVersionSent = -1;
  let frameQueue = Promise.resolve();

  /*
   * A PING, not a frame. The document itself is `GET ./events/frame` — built
   * once per (id, edit_id) and cached (lib/story/frame), fetched by whoever
   * wants it under the same ACL. This stream therefore carries nothing a relay
   * would have to understand, which is what lets a proxy blind to content
   * hold it (plan §3).
   */
  const frameFor = async (row: NonNullable<Awaited<ReturnType<typeof getArtifactById>>>): Promise<ArtifactVersionPing> => ({
    editId: row.edit_id,
    version: row.version,
    by: await authorHandle(row),
  });

  const queueRow = (row: NonNullable<Awaited<ReturnType<typeof getArtifactById>>>) => {
    frameQueue = frameQueue.then(async () => {
      if (closed || row.version < lastVersionSent) return;
      const frame = await frameFor(row);
      if (closed || frame.version < lastVersionSent) return;
      lastVersionSent = frame.version;
      // Follow this version's data dependencies BEFORE announcing it: a
      // document that starts reading a dataset must be subscribed by the time
      // its reader can see the query, or a write landing in between reaches
      // nobody and the chart sits stale until the next interaction.
      // A FOLDER's one data dependency is ITSELF, which is what makes a
      // child's publish reach an open folder page through the path a dataset
      // write already travels.
      await followDatasets(row);
      await send(frame);
      // An edit shifts anchors; the owner's pins must follow the document
      // frame that moved them. No-op on every non-owner connection.
      void pushAnnotations();
    }).catch(() => { /* client gone */ });
  };

  // The catch-up read. Re-reading (rather than trusting the payload) is what
  // makes a missed or duplicated wakeup harmless.
  const pushCurrent = async () => {
    if (closed) return;
    const row = await getArtifactById(id);
    if (!row) return void close(); // deleted while watching
    // Re-check on EVERY wakeup, not just at connect: a stream is long-lived
    // and access is not. Without this, someone who connected while a document
    // was public kept receiving everything written after it was made private
    // — revocation that never reached the one reader it was aimed at.
    if (!(await canReadArtifact(row, viewer))) return void close();
    queueRow(row);
  };

  try {
    unsubscribe = await subscribeToArtifact(artifactId, () => void pushCurrent());
    // The document's DATA dependencies are subscribed at CONNECT, from the row
    // this handler opened with — not from the first frame. The opening frame is
    // queued rather than awaited (see below), so waiting for it would leave a
    // window in which a write to this document's dataset reached nobody.
    // Later frames adjust the set when an edit changes what the document reads.
    await followDatasets(initial);
    if (annotatorConnection) {
      try {
        annotationsUnsub = await subscribeToAnnotations(artifactId, () => void pushAnnotations());
      } catch (error) {
        // At capacity: the document still streams; annotation changes then
        // arrive with the next document frame instead of on their own.
        if (!(error instanceof TooManyLiveChannels)) throw error;
      }
    }
  } catch (error) {
    // At capacity: say so plainly instead of holding a stream that will never
    // deliver. The page still renders and reloads fine without live updates.
    if (!(error instanceof TooManyLiveChannels)) throw error;
    clearInterval(keepalive);
    await writer.close().catch(() => {});
    return new Response('too many live documents', { status: 503, headers: { 'Retry-After': '30' } });
  }
  request.signal.addEventListener('abort', () => void close());
  // NOT awaited: a TransformStream applies backpressure from the first chunk
  // (its readable side has highWaterMark 0), so awaiting here would block
  // until a reader existed — and the reader only exists once this Response is
  // returned. Queue the opening frame and hand the stream over.
  //
  // The opening frame is a CATCH-UP READ, not the row this handler opened with
  // (`initial`). That row is read at the top, before the session lookup, the
  // ACL query and the LISTEN above — so a write committing in that window
  // would be lost twice over: absent from the frame (the row predates it) and
  // unheard (nobody was subscribed yet). Nothing later would rescue it, because
  // every other frame is driven by a wakeup, so the reader would sit on a stale
  // document until it reloaded. Reading again here is what makes "the first
  // frame is always current state" true, and that sentence is the whole reason
  // a missed notification is harmless.
  //
  // It goes through `pushCurrent`, so it takes the same ACL re-check and the
  // same ordered `queueRow` path (version-guarded) as every later frame.
  void pushCurrent();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
      /*
       * The DOCUMENT listens on this too (lib/story-runtime/live-entry), and a
       * served document is sandboxed without `allow-same-origin` even when it
       * is what the reader is looking at — so its origin is "null" and its own
       * stream is a cross-origin request to it.
       *
       * Safe for exactly the reason the query endpoint's is (app/a/[id]/query):
       * an opaque-origin request carries NO cookies, so this answers it as a
       * stranger — a public document streams, a private one is the uniform 404
       * — and `*` cannot hand a third-party site anything it could not fetch
       * for itself anyway. The owner's page, being same-origin, is unaffected.
       */
      'Access-Control-Allow-Origin': '*',
    },
  });
}
