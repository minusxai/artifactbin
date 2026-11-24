/**
 * THE DOCUMENT'S LIVE STREAM (GET /a/:id/events, which translates this to HTTP): Server-Sent Events carrying this artifact's document
 * as it changes, so an open page (viewing OR editing) stays live.
 *
 * A sub-path of the one shareable URL, like /a/:id/raw and /a/:id/export. Anyone who
 * may read the page may watch it change — it reveals nothing a reload would
 * not.
 *
 * The transport is the chat-stream pattern: a NOTIFY is only a wakeup
 * pointer, and every wakeup does a catch-up SELECT, so a missed notification
 * costs nothing. The first frame is always the current state, which makes the
 * stream self-syncing — a client that connects late, reconnects, or misses a
 * wakeup converges on the next event with no cursor bookkeeping.
 */
import { ID_RE } from '@/lib/platform';
import { trackEvent } from '@/lib/analytics';
import { canReadArtifact, currentPage, readableArtifact, getArtifactAccessById, getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import { authorHandle, ANONYMOUS_ACTOR } from '@/lib/accounts';
import { sessionActor } from '@/lib/authentication';
import { STORY_ANNOTATIONS_EVENT, type ArtifactVersionPing } from '@/lib/html-reader/contract';
import { LIVE_KEEPALIVE_MS, liveKeepaliveFrame } from '@/lib/http';
import { subscribeChannel, subscribeToAnnotations, subscribeToArtifact, TooManyLiveChannels } from './live';
import { changedSince } from './dataset-marks';
import { livePings } from './live-pings';
import { sseChannel } from './sse-channel';
import { datasetFollower } from './dataset-follower';
import { presenceFollower } from './presence-follower';

/** What a live ping names: the head and its live revision, and the current page's title. */
interface LiveHead { editId: string; version: number; live: number; title: string | null }
/** The process's live text followers (./live-pings): one subscription and one throttled read per page, shared by its readers. */
const pageLive = livePings<LiveHead | null>({
  subscribe: (channel, handler, onLost) => subscribeChannel(channel, handler, onLost),
  async load(id) {
    const row = await getArtifactById(id);
    if (!row || row.format !== 'html') return null;
    const page = await currentPage(row);
    return { editId: row.edit_id, version: row.version, live: page.live, title: page.row.title ?? null };
  },
});

/**
 * What opening the stream came to: the uniform not-found (a missing, malformed or unreadable document), no
 * room for another live channel, or the open stream, which ends when `request` is aborted or the reader goes.
 */
export type DocumentEvents = { status: 'not_found' } | { status: 'busy' } | { status: 'open'; stream: ReadableStream<Uint8Array> };

/*
 * The heartbeat (lib/http/app-build liveKeepaliveFrame): keeps proxies from
 * closing an idle stream AND tells the client the stream is alive. A NAMED
 * event, not a `: comment` line — a comment never reaches script, and the
 * client (lib/live-stream) treats LIVE_SILENCE_MS without any event as a dead
 * stream and reopens it. It names the server's build, which is how an open
 * tab learns a deploy happened.
 */

export async function openDocumentEvents(request: Request, id: string): Promise<DocumentEvents> {
  if (!ID_RE.test(id)) return { status: 'not_found' };
  // Same uniform 404 as app/a/[id]/raw — and the same VIEWER as it and the proxy
  // (sessionActor uses the proxy-attached actor first, then direct compatibility
  // and the agent cookie). Resolving it any other way drops an anonymous
  // owner's live stream the moment their document goes private.
  const actor = new URL(request.url).searchParams.get('anonymous')==='1'?ANONYMOUS_ACTOR:await sessionActor(request);
  const initial = (await readableArtifact(actor, id, { admission: 'account' }))?.row;
  if (!initial) return { status: 'not_found' };
  const artifactId = initial.id;
  // Connect only — never in the wakeup loop, which fires per remote edit.
  void trackEvent('sse_connect', artifactId, { userId: actor.userId });

  /*
   * EVERY WAKEUP ASKS ADMISSION AGAIN: a stream is long-lived and access is not. Without this, someone who connected
   * while a document was public kept receiving everything written after it was made private — revocation that never
   * reached the one reader it was aimed at. `readableRow` re-reads the row (deleted while watching, or no longer
   * readable: the stream ends); `stillReadable` asks of the access columns alone.
   */
  const readableRow = async (): Promise<ArtifactRow | null> => {
    const row = (await readableArtifact(actor, id, { admission: 'account' }))?.row;
    if (row) return row;
    void close();
    return null;
  };
  const stillReadable = async () => { const access = await getArtifactAccessById(id); return !!access && await canReadArtifact(access, actor); };

  const channel = sseChannel();
  let closed = false;
  let unsubscribe: (() => Promise<void>) | undefined;
  let liveUnsub: (() => void) | undefined;
  let annotationsUnsub: (() => Promise<void>) | undefined;

  /**
   * THE DATABASE LISTENER WENT AWAY (lib/db PostgresDb): no wakeup can reach
   * this stream any more, though its keepalive would go on saying it is fine.
   * End it: the client reconnects, the new connection LISTENs afresh, and its
   * opening frame is a catch-up read, so nothing written meanwhile is lost.
   */
  const listenerLost = () => void close();
  const datasets = datasetFollower({
    format: initial.format, actor, channel, since: new URL(request.url).searchParams.get('since'), lost: listenerLost,
    onWake: datasetId => void (async () => { if (closed) return; const row = await readableRow(); if (row) await datasets.wake(datasetId, row); })(),
  });
  const presence = presenceFollower({ id, actor, channel, close: () => void close() });
  const send = (event: ArtifactVersionPing) => channel.send(JSON.stringify(event), { id: datasets.position() });

  /**
   * Comment pings follow document read admission, rechecked on every wakeup.
   * The event carries no comment content; the listing independently checks admission.
   */
  const pushAnnotations = async () => {
    if (closed || !(await readableRow())) return;
    void channel.send('{}', { event: STORY_ANNOTATIONS_EVENT });
  };

  const keepalive = setInterval(() => void channel.sendFramed(liveKeepaliveFrame()), LIVE_KEEPALIVE_MS);

  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    presence.dispose();
    if (unsubscribe) await unsubscribe().catch(() => {});
    liveUnsub?.();
    if (annotationsUnsub) await annotationsUnsub().catch(() => {});
    await datasets.close();
    await channel.close();
  };
  // A cancelled response reader rejects the writable side even when the request's
  // signal stays live (for example a streaming client that releases its body).
  // Release every LISTEN immediately, rather than waiting for another write to fail.
  void channel.gone.catch(() => void close());

  // Last stylesheet sent on THIS connection, so repeats can be skipped.
  let lastVersionSent = -1;
  /** The live revision last announced within `lastVersionSent` (an HTML page's live text, ./live-pings). */
  let lastLiveSent = -1;
  let documentSent = false;
  let frameQueue = Promise.resolve();

  /*
   * A PING, not a frame. The document itself is `GET /a/:id/events/frame` — built
   * once per (id, edit_id) and cached (lib/publish/data/frame), fetched by whoever
   * wants it under the same ACL. This stream therefore carries nothing a relay
   * would have to understand, which is what lets a proxy blind to content
   * hold it.
   */
  const frameFor = async (row: ArtifactRow): Promise<ArtifactVersionPing> => {
    // An HTML page is announced as its current page (lib/artifacts current-page): its live revision and its title.
    const page = row.format === 'html' ? await currentPage(row) : null;
    return {
      editId: row.edit_id,
      version: row.version,
      ...(page ? { live: page.live } : {}),
      by: await authorHandle(row),
      title: (page?.row ?? row).title ?? null,
    };
  };

  const queueRow = (row: ArtifactRow) => {
    frameQueue = frameQueue.then(async () => {
      if (closed || row.version < lastVersionSent) return;
      const frame = await frameFor(row);
      if (closed || frame.version < lastVersionSent) return;
      // A new version starts its live revisions afresh (a version that closed regions may sum to less than before).
      const sameVersion = frame.version === lastVersionSent;
      lastVersionSent = frame.version;
      lastLiveSent = Math.max(sameVersion ? lastLiveSent : -1, frame.live ?? 0);
      // Follow this version's data dependencies BEFORE announcing it: a
      // document that starts reading a dataset must be subscribed by the time
      // its reader can see the query, or a write landing in between reaches
      // nobody and the chart sits stale until the next interaction.
      // A FOLDER's one data dependency is ITSELF, which is what makes a
      // child's publish reach an open folder page through the path a dataset
      // write already travels.
      await presence.follow(row);
      await datasets.follow(row);
      await datasets.pushShared(row);
      await send(frame);
      if (!documentSent) { documentSent = true; presence.documentSent(); }
      // An edit shifts anchors; annotator connections' pins must follow the document
      // frame that moved them. Plain reader connections are no-ops.
      void pushAnnotations();
    }).catch(() => { /* client gone */ });
  };

  /*
   * LIVE TEXT (./live-pings): the page's regions changed with no new version. Within the version this connection has
   * announced, a higher live revision is pinged exactly as a version is (the reader's frame re-fetches the current
   * page); a new version is the document channel's to announce, with its presence and data follows. Access is asked
   * again first, from the access columns alone.
   */
  const pushLive = (head: () => Promise<LiveHead | null>) => {
    frameQueue = frameQueue.then(async () => {
      if (closed) return;
      if (!(await stillReadable())) return void close();
      const current = await head();
      if (closed || !current || current.version !== lastVersionSent || current.live <= lastLiveSent) return;
      lastLiveSent = current.live;
      await send({ editId: current.editId, version: current.version, live: current.live, by: null, title: current.title });
    }).catch(() => { /* client gone */ });
  };

  // The catch-up read. Re-reading (rather than trusting the payload) is what
  // makes a missed or duplicated wakeup harmless.
  const pushCurrent = async (payload?: string) => {
    if (closed) return;
    const row = await readableRow();
    if (!row) return;
    if (payload === 'members') void datasets.sendData({datasets:['_members'],version:row.version});
    queueRow(row);
  };

  try {
    unsubscribe = await subscribeToArtifact(artifactId, payload => void pushCurrent(payload), listenerLost);
    // The document's DATA dependencies are subscribed at CONNECT, from the row
    // this handler opened with — not from the first frame. The opening frame is
    // queued rather than awaited (see below), so waiting for it would leave a
    // window in which a write to this document's dataset reached nobody.
    // Later frames adjust the set when an edit changes what the document reads.
    await datasets.follow(initial);
    if (initial.format === 'html') {
      try {
        liveUnsub = await pageLive.follow(artifactId, { tick: pushLive, lost: listenerLost });
        if (closed) liveUnsub();
      } catch (error) {
        // At capacity: the document still streams its versions; live text then arrives with the next one.
        if (!(error instanceof TooManyLiveChannels)) throw error;
      }
    }
    try {
      annotationsUnsub = await subscribeToAnnotations(artifactId, () => void pushAnnotations(), listenerLost);
    } catch (error) {
      // At capacity: the document still streams; annotation changes then
      // arrive with the next document frame instead of on their own.
      if (!(error instanceof TooManyLiveChannels)) throw error;
    }
  } catch (error) {
    // At capacity: say so plainly instead of holding a stream that will never
    // deliver. The page still renders and reloads fine without live updates.
    // Either way, nothing this stream opened is left behind.
    await close();
    if (!(error instanceof TooManyLiveChannels)) throw error;
    return { status: 'busy' };
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
  /*
   * WHERE A SERVED PAGE LEFT OFF (`?since=`, lib/publish/prepared/served-results.server):
   * a page whose first rows came with its HTML names the datasets they were
   * computed from and a mark of each. Every one that has moved since is sent
   * the ordinary `data` frame NOW — after the subscriptions above, so nothing
   * falls between this check and the wakeups that follow it. The frame names a
   * dataset this document reads and nothing else, exactly as a wakeup would.
   */
  const since = new URL(request.url).searchParams.get('since');
  if (since && initial.format !== 'html') {
    void changedSince(since, datasets.followed())
      .then(async (changed) => { for (const datasetId of changed) { if (closed) return; const row = await readableRow(); if (row) await datasets.wake(datasetId, row); } })
      .catch(() => { /* a failed catch-up is a missed wakeup: the next change still arrives */ });
  }

  return { status: 'open', stream: channel.readable };
}
