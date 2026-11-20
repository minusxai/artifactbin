/**
 * THE DOCUMENT'S DATASETS, WATCHED BESIDE THE DOCUMENT ITSELF (one live stream's half, ./document-events).
 *
 * A dataset write is a version on the DATASET's row and a NOTIFY on the DATASET's channel
 * (lib/document-data/dataset-mutate): nothing about the document changes, so the document's own stream would never
 * mention it and every chart built on that data would sit stale until someone reloaded. So the stream also listens on
 * each dataset the document reads or writes, and forwards a small `data` frame naming it; the runtime re-runs exactly
 * the queries that read it (lib/dataflow/dataflow queriesReadingDatasets).
 *
 * A separate SSE EVENT NAME, deliberately: the default `message` frame is the document ping and is guarded by
 * `editId`/`version` at both ends, and a data wakeup carries neither. Old clients ignore an unknown event name.
 *
 * Interface: `follow(row)` adjusts the subscriptions to what this version of the row reads (an edit can add or drop
 * a query, so it is asked on every document frame); `pushShared(row)` sends an HTML page's shared revisions that moved
 * since its last frame; `wake(datasetId, row)` sends the frame for a followed dataset that
 * changed, after the stream re-admitted the reader to `row`; `sendData` sends any `data` frame; `position()` is the
 * resume `id:` every document and data frame carries; `followed()` the datasets followed; `close()` drops them all.
 */
import { canReadArtifact, getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { changedHtmlSharedRevisions, htmlLiveLinks, htmlSharedRevisions } from '@/lib/html-publication';
import { STORY_DATA_EVENT, type ArtifactDataEvent } from '@/lib/html-reader';
import { subscribeToArtifact, TooManyLiveChannels } from './live';
import { liveDatasetIds, marksOf, marksOfToken, tokenOf } from './dataset-marks';
import type { SseChannel } from './sse-channel';

export interface DatasetFollower {
  follow(row: ArtifactRow): Promise<void>;
  pushShared(row: ArtifactRow): Promise<void>;
  wake(datasetId: string, row: ArtifactRow): Promise<void>;
  sendData(event: ArtifactDataEvent): Promise<boolean>;
  position(): string | undefined;
  followed(): string[];
  close(): Promise<void>;
}

export function datasetFollower(options: {
  /** The document's format: an HTML page reads its datasets as shared revisions and carries no resume marks. */
  format: string;
  actor: AccessActor;
  channel: Pick<SseChannel, 'send'>;
  /** The `?since=` token the reader reconnected with. */
  since: string | null;
  /** A followed dataset's NOTIFY: the stream re-admits the reader, then calls `wake`. */
  onWake(datasetId: string): void;
  /** The database listener went away, or a frame could not be built: the stream ends. */
  lost(): void;
}): DatasetFollower {
  const { format, actor, channel } = options;
  let closed = false;
  let sharedMarks = new Map<string, string>();
  const unsubs = new Map<string, () => Promise<void>>();

  /**
   * WHERE THIS READER STANDS: the mark of every dataset the stream follows (lib/publish/prepared/served-results
   * `marksOf`), sent as the SSE `id:` of every document and data frame. A connection that is cut (an idle proxy, a
   * deploy, a sleeping laptop) reopens with `?since=<the last id>` (lib/http/live-stream), and the stream's `since`
   * catch-up sends the `data` frame for every dataset that moved in the gap — once: the cursor a frame carries already
   * includes the change it announces. Marks are taken after the dataset is subscribed, so a write after the mark
   * always wakes the stream. A `since` the reader brings seeds them, so the opening frame never claims a position
   * past a change the catch-up has not sent yet.
   */
  const marks = marksOfToken(options.since);
  const position = () => {
    if (format === 'html') return undefined;
    for (const datasetId of [...marks.keys()]) if (!unsubs.has(datasetId)) marks.delete(datasetId);
    return marks.size ? tokenOf(marks) : undefined;
  };
  const sendData = (event: ArtifactDataEvent) => channel.send(JSON.stringify(event), { event: STORY_DATA_EVENT, id: position() });

  let sharedQueue = Promise.resolve();
  const pushShared = (row: ArtifactRow) => sharedQueue = sharedQueue.then(async () => {
    if (row.format !== 'html' || closed) return;
    const current = await htmlSharedRevisions(await getDb(), htmlLiveLinks(row.meta), { mayReadDataset: async datasetId => { const dataset = await getArtifactById(datasetId); return !!dataset && dataset.format === 'dataset' && await canReadArtifact(dataset, actor); } });
    if (closed) return;
    const changed = changedHtmlSharedRevisions(sharedMarks, current);
    sharedMarks = new Map(current.map(mark => [mark.name, mark.revision]));
    if (changed.length) await sendData({ datasets: changed.map(mark => mark.name), version: row.version, revisions: Object.fromEntries(changed.map(mark => [mark.name, mark.revision])) });
  }).catch(() => { options.lost(); });

  /**
   * Follow exactly the datasets this version of the row depends on.
   *
   * A FOLDER DEPENDS ON ITSELF, and that rule is stated here rather than inferred from its stored source: a folder
   * HAS no source, so nothing would name it and an open listing would sit stale until someone reloaded. A child write
   * NOTIFYs the parent's channel (lib/folders notifyParent) and travels as an ordinary `event: data` frame naming the
   * folder's id, so the folder page and an authored `<Files>` document both re-read on the same ping.
   */
  const follow = async (row: ArtifactRow) => {
    if (closed) return;
    const wanted = new Set(row.format === 'html' ? liveDatasetIds(htmlLiveLinks(row.meta)) : row.format === 'folder' ? [row.id] : []);
    for (const [datasetId, drop] of unsubs) {
      if (wanted.has(datasetId)) continue;
      unsubs.delete(datasetId);
      await drop().catch(() => {});
    }
    const added: string[] = [];
    for (const datasetId of wanted) {
      if (unsubs.has(datasetId)) continue;
      try {
        // Reserve the slot before awaiting, so two frames arriving together cannot open two subscriptions to the same channel.
        unsubs.set(datasetId, async () => {});
        const drop = await subscribeToArtifact(datasetId, () => options.onWake(datasetId), options.lost);
        if (closed) { await drop().catch(() => {}); unsubs.delete(datasetId); return; }
        unsubs.set(datasetId, drop);
        added.push(datasetId);
      } catch (error) {
        // At capacity: the document itself still streams. Data updates then arrive on the reader's next interaction rather than on their own.
        unsubs.delete(datasetId);
        if (!(error instanceof TooManyLiveChannels)) throw error;
      }
    }
    // Newly followed: marked now that they are subscribed (a mark the reader brought is kept for the catch-up).
    if (row.format !== 'html' && added.length) for (const [datasetId, mark] of await marksOf(added)) if (!marks.has(datasetId)) marks.set(datasetId, mark);
  };

  /**
   * A dataset wakeup, for a reader the stream has just re-admitted to the document. The payload is deliberately tiny:
   * which dataset, and the version it reached. The rows themselves come from the query endpoint, under the same ACL as
   * everything else, so this frame reveals nothing a reader could not already fetch.
   */
  const wake = async (datasetId: string, row: ArtifactRow) => {
    if (row.format === 'html') { await pushShared(row); return; }
    const [dataset, now] = await Promise.all([getArtifactById(datasetId), unsubs.has(datasetId) ? marksOf([datasetId]) : null]);
    const mark = now?.get(datasetId);
    if (mark) marks.set(datasetId, mark);
    void sendData({ datasets: [datasetId], version: dataset?.version ?? 0 });
  };

  return {
    follow,
    pushShared,
    wake,
    sendData,
    position,
    followed: () => [...unsubs.keys()],
    async close() {
      closed = true;
      for (const drop of unsubs.values()) await drop().catch(() => {});
      unsubs.clear();
    },
  };
}
