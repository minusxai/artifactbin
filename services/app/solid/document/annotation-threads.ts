/**
 * THE THREADS A COMMENT LAYER HOLDS, and every write to them.
 *
 * `createThreadStore` keeps the three lists in step — open threads, the authorised resolved index, and threads
 * resolved by somebody else that still count down on the page — together with which thread is open, what this
 * viewer folded and whether a write is in flight. Reads may finish out of order or after a live event or a local
 * write; only a current snapshot replaces the list, and the live stream replaces it wholesale.
 *
 * Interface: the lists (`rows` open, `resolved`, `recent`, `openIds`, `resolvedIds`, `floatingRows`, `pinRows`), the
 * open thread (`openId`, `justOpenedId`, `open`, `unfoldComment`, `focus`, `inspect`, `resolvedOpen`, `toggleResolved`), folds
 * (`folded`, `toggleFold`), the countdown (`counting`, `countDown`) and the writes (`busy`, `working`, `act`,
 * `actOrThrow`, `edit`, `react`, `remove`, `added`).
 */
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type Accessor } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations';
import { BackendRequestError, type AnnotationActionBody, type ArtifactBackend } from '@/lib/artifact-backend';
import { isFolded, readFolds, toggleFold, unfold, type FoldKind, type Folds } from '@/lib/annotations/comment-folds';

/** A thread resolved elsewhere, kept on the page for `remaining` milliseconds of being seen. */
type Retained = Record<string, { row: AnnotationWire; remaining: number }>;

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
/** `rows` with `wire` in place of its old row. */
const swap = (rows: AnnotationWire[], wire: AnnotationWire) => rows.map((row) => (row.id === wire.id ? wire : row));
/** `rows` with `wire` in place of its old row, or added at the end. */
const upsert = (rows: AnnotationWire[], wire: AnnotationWire) => rows.some((row) => row.id === wire.id) ? swap(rows, wire) : [...rows, wire];
/** `open`, then the retained threads not already among them. */
const plusRetained = (open: AnnotationWire[], retained: Retained[string][]) => [...open, ...retained.map((value) => value.row).filter((row) => !open.some((item) => item.id === row.id))];
/** `rows` without the thread or reply `id` (a thread that loses a reply moves to its next revision). */
const withoutComment = (rows: AnnotationWire[], id: string) => rows.flatMap((row) => {
  if (row.id === id) return [];
  if (!row.thread.some((comment) => comment.id === id)) return [row];
  return [{ ...row, revision: (row.revision ?? 1) + 1, thread: row.thread.filter((comment) => comment.id !== id) }];
});

export type ThreadStore = ReturnType<typeof createThreadStore>;

export function createThreadStore(options: {
  backend: ArtifactBackend;
  artifactId: () => string;
  mayCreate: () => boolean;
  railOpen: Accessor<boolean>;
  live: Accessor<AnnotationWire[] | null>;
}) {
  const { backend, mayCreate, railOpen } = options;
  const [annotations, writeAnnotations] = createSignal<AnnotationWire[]>([]);
  let annotationEpoch = 0, readSequence = 0, appliedRead = 0;
  const setAnnotations: typeof writeAnnotations = (next) => { annotationEpoch++; return writeAnnotations(next); };
  // Network responses never revoke newer state: a read started before a live event or local write is dropped.
  const readAnnotations = (signal: AbortSignal) => {
    const epoch = annotationEpoch, sequence = ++readSequence;
    void backend.listAnnotations(undefined, { signal }).then((list) => {
      if (!signal.aborted && epoch === annotationEpoch && sequence > appliedRead) {
        appliedRead = sequence; writeAnnotations(list);
      }
    }).catch(() => {});
  };
  const [recentResolved, setRecentResolved] = createSignal<Retained>({});
  // A resolution this viewer just acknowledged is history, not an unseen remote event. Keep every
  // acknowledged revision so a delayed index read cannot resurrect its countdown; a later revision
  // from another viewer still gets the usual countdown.
  const locallyResolvedRevisions = new Map<string, Set<number | undefined>>();
  const wasLocallyResolved = (row: AnnotationWire) => locallyResolvedRevisions.get(row.id)?.has(row.revision) ?? false;
  let previousOpen = new Set<string>();
  const [resolvedList, setResolvedList] = createSignal<AnnotationWire[] | null>(null);
  /*
   * ONE OPEN THREAD, open or resolved. A resolved thread somebody expands IS the open thread: that
   * is what makes the document highlight its passage and scroll to it. Its row is not in
   * `annotations` — never dereference the open id against that list without a fallback.
   */
  const [openId, setOpenId] = createSignal<string | null>(null);
  /** The resolved group starts collapsed — local to this rail, never stored. Whatever is being looked at forces it open. */
  const [resolvedOpen, setResolvedOpen] = createSignal(false);
  const [inspectedResolvedId, setInspectedResolvedId] = createSignal<string | null>(null);
  /** What this viewer folded — read from the store, so a remount or a reload cannot lose it. */
  const [folds, setFolds] = createSignal<Folds>(readFolds(untrack(options.artifactId)));
  /** The thread this viewer just asked for; its newest comment is never folded. */
  const [justOpenedId, setJustOpenedId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  createEffect(on(annotations, (list) => setInspectedResolvedId((current) => list.some((row) => row.id === current) ? null : current)));
  const hasRemoteWork = createMemo(() => annotations().some((row) => row.remote_work?.length));
  createEffect(() => {
    void railOpen();
    if (!hasRemoteWork() || busy()) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      readAnnotations(abort.signal);
    }, 15000);
    onCleanup(() => { clearInterval(timer); abort.abort(); });
  });
  // Folds are per artifact: a different document's rail starts from its own.
  createEffect(on(options.artifactId, (id) => setFolds(readFolds(id)), { defer: true }));

  // The session's own read; the live stream replaces it wholesale.
  onMount(() => {
    const abort = new AbortController();
    readAnnotations(abort.signal);
    onCleanup(() => abort.abort());
  });
  createEffect(() => { const live = options.live(); if (live) setAnnotations(live); });

  // Refresh the authorised resolved index when open threads disappear. Never infer resolution from
  // absence: deletion or revocation must remove the content instead.
  createEffect(() => {
    const open = annotations();
    const railIsOpen = railOpen();
    const before = previousOpen;
    previousOpen = new Set(open.map((row) => row.id));
    const removed = [...before].filter((id) => !previousOpen.has(id));
    const recent = untrack(recentResolved);
    if (!railIsOpen && !removed.length && !Object.keys(recent).length) return;
    const abort = new AbortController();
    void backend.listAnnotations('resolved', { signal: abort.signal }).then((fetched) => {
      if (abort.signal.aborted) return;
      const list = fetched.filter((row) => !open.some((item) => item.id === row.id));
      batch(() => {
        setResolvedList(list);
        setRecentResolved((current) => {
          const next: typeof current = {};
          for (const row of list) {
            if (wasLocallyResolved(row)) continue;
            const old = current[row.id];
            if (removed.includes(row.id) || old) next[row.id] = { row, remaining: old && old.row.revision === row.revision ? old.remaining : 10000 };
          }
          return next;
        });
        setOpenId((current) => current && (removed.includes(current) || recent[current]) && !list.some((row) => row.id === current) && !previousOpen.has(current) ? null : current);
      });
    }).catch(() => { if (!abort.signal.aborted) batch(() => { setRecentResolved({}); setResolvedList(null); setOpenId(null); }); });
    onCleanup(() => abort.abort());
  });

  const openIds = createMemo(() => annotations().map((row) => row.id), undefined, { equals: sameIds });
  const resolvedIds = createMemo(() => (resolvedList() ?? []).map((row) => row.id), undefined, { equals: sameIds });
  // A resolved thread that is open (a link, a pin, a card) or was just asked for must never sit behind the collapsed heading.
  createEffect(() => { const open = openId(); if (open && resolvedIds().includes(open)) setResolvedOpen(true); });
  createEffect(on(justOpenedId, (id) => { if (id && untrack(resolvedIds).includes(id)) setResolvedOpen(true); }));

  const retained = () => Object.values(recentResolved()).filter((value) => value.remaining > 0);
  const retainedPinIds = createMemo(() => retained().map((value) => value.row.id).join(','));
  /** Open threads plus those still counting down: what the document edge marks. */
  const floatingRows = createMemo(() => plusRetained(annotations(), retained()));
  /**
   * Every thread with a pin in the document. Reading it tracks the retained SET, never a countdown tick. The ONE resolved
   * thread this viewer expanded rides with the open roots, beside its `openId`: the runtime records the scroll as done when
   * an open id arrives. Other resolved rows only hold their place (`layoutOnly`).
   */
  const pinRows = () => {
    void retainedPinIds();
    const open = openId();
    const inspected = inspectedResolvedId();
    const recent = untrack(recentResolved);
    const current = annotations();
    const openResolved = open ? (resolvedList() ?? []).find((row) => row.id === open) ?? recent[open]?.row ?? null : null;
    return plusRetained(openResolved ? [...current, openResolved] : current, Object.values(recent).filter((value) => value.remaining > 0))
      .filter((row) => !row.orphaned && row.anchor)
      .map((row) => ({ row, layoutOnly: row.status === 'resolved' && (row.id !== inspected || row.id !== open) }));
  };

  /** A thread as the server now answers it, wherever this viewer holds it (open, resolved, or counting down). */
  const replaceThread = (wire: AnnotationWire) => batch(() => {
    setAnnotations((prev) => swap(prev, wire));
    setResolvedList((prev) => prev && swap(prev, wire));
    setRecentResolved((current) => current[wire.id] ? { ...current, [wire.id]: { ...current[wire.id]!, row: wire } } : current);
  });
  /** After a conflict: show the thread as it now stands, so the next try applies to it. */
  const reread = async (rootId: string) => {
    const [open, resolved] = await Promise.all([backend.listAnnotations('open'), backend.listAnnotations('resolved')]).catch(() => [[], []]);
    const fresh = [...open, ...resolved].find((row) => row.id === rootId);
    if (fresh) replaceThread(fresh);
  };
  const conflict = (cause: unknown) => cause instanceof BackendRequestError && cause.code === 'annotation_conflict';
  const working = async <T>(work: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try { return await work(); } finally { setBusy(false); }
  };

  /** One thread write; rejects with the backend's refusal (a reply's box shows which), `act` turns that into false. */
  const actOrThrow = async (annId: string, body: AnnotationActionBody) => {
    if (!mayCreate()) return false;
    return working(async () => {
      let wire: AnnotationWire;
      try { wire = await backend.actOnAnnotation(annId, body); }
      catch (cause) {
        // A resolve/reopen against a thread that moved: show the thread as it now stands instead of a generic error.
        if (conflict(cause)) await reread(annId);
        throw cause;
      }
      if (body.resolve && wire.status === 'resolved') locallyResolvedRevisions.set(annId, (locallyResolvedRevisions.get(annId) ?? new Set()).add(wire.revision));
      batch(() => {
        setAnnotations((prev) => wire.status === 'resolved' ? prev.filter((row) => row.id !== annId) : upsert(prev, wire));
        setResolvedList((prev) => !prev ? prev : wire.status === 'open' ? prev.filter((row) => row.id !== annId) : upsert(prev, wire));
        if (wire.status === 'resolved') {
          setRecentResolved((current) => current[annId]?.row.revision === wire.revision ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== annId)) : current);
          // The thread being looked at moves into resolved history: open the group so it is still there.
          if (untrack(openId) === annId) setResolvedOpen(true);
          setOpenId((current) => (current === annId ? null : current));
        }
        else if (body.reopen) {
          // It was the open thread while it was resolved history; it stays the open thread.
          setOpenId(annId);
          setJustOpenedId(annId);
        }
      });
      return true;
    });
  };

  /** One comment's words, against the thread revision this viewer read. A refusal rejects (the editor keeps the draft); a conflict first re-reads the thread so saving again applies. */
  const edit = async (rootId: string, commentId: string, body: string) => {
    if (!mayCreate()) throw new Error('You have read-only comment access.');
    const held = [...annotations(), ...(resolvedList() ?? [])].find((row) => row.id === rootId);
    try {
      replaceThread(await backend.editAnnotation(commentId, { body, ...(held?.revision !== undefined ? { expected_revision: held.revision } : {}) }));
    } catch (cause) {
      if (conflict(cause)) await reread(rootId);
      throw cause;
    }
  };

  const remove = (annId: string) => working(async () => {
    await backend.deleteAnnotation(annId);
    batch(() => {
      setAnnotations((prev) => withoutComment(prev, annId));
      setResolvedList((prev) => prev && withoutComment(prev, annId));
      // A retained thread loses the comment too, or goes with it.
      setRecentResolved((current) => Object.fromEntries(Object.entries(current).flatMap(([rootId, value]) =>
        withoutComment([value.row], annId).map((row) => [rootId, row === value.row ? value : { ...value, row }]))));
      setOpenId((current) => (current === annId ? null : current));
    });
  });

  return {
    rows: annotations,
    resolved: resolvedList,
    recent: recentResolved,
    openIds,
    resolvedIds,
    floatingRows,
    pinRows,
    openId,
    justOpenedId,
    resolvedOpen,
    toggleResolved: () => setResolvedOpen((open) => !open),
    /*
     * OPENING A THREAD UNFOLDS IT. Somebody who clicks a pin, follows a message or has just written a
     * comment came for an answer; the thread and its newest comment open together, in one write.
     */
    open: (annId: string) => batch(() => {
      const row = untrack(annotations).find((item) => item.id === annId);
      const newest = row?.thread.at(-1)?.id;
      setOpenId(annId);
      setInspectedResolvedId(row ? null : annId);
      setJustOpenedId(annId);
      setFolds(unfold(untrack(options.artifactId), { threads: [annId], comments: newest ? [newest] : [] }));
    }),
    /** Show one comment of a thread unfolded (a notification's target). */
    unfoldComment: (threadId: string, commentId: string) => setFolds(unfold(untrack(options.artifactId), { threads: [threadId], comments: [commentId] })),
    /** No thread is open (null), or this one is, without unfolding anything. */
    focus: (id: string | null) => setOpenId(id),
    /** A resolved thread expanded in the rail becomes the open thread; pressed again it closes. */
    inspect: (id: string) => batch(() => { setJustOpenedId(id); setInspectedResolvedId(id); setOpenId((current) => current === id ? null : id); }),
    folded: (kind: FoldKind, id: string) => isFolded(folds(), kind, id),
    toggleFold: (kind: FoldKind, id: string) => setFolds(toggleFold(untrack(options.artifactId), kind, id)),
    counting: createMemo(() => retained().length > 0),
    /** `elapsed` ms off every retained thread `counts` accepts (seen, not hovered, not open). */
    countDown: (elapsed: number, counts: (id: string) => boolean) => setRecentResolved((current) => {
      let changed = false;
      const next = Object.fromEntries(Object.entries(current).map(([key, value]) => {
        if (value.remaining <= 0 || !counts(key)) return [key, value];
        changed = true;
        return [key, { ...value, remaining: Math.max(0, value.remaining - elapsed) }];
      }));
      return changed ? next : current;
    }),
    busy,
    working,
    actOrThrow,
    act: (annId: string, body: AnnotationActionBody) => actOrThrow(annId, body).catch(() => false),
    edit,
    react: async (commentId: string, active: boolean) => { replaceThread(await backend.setCommentReaction(commentId, { kind: 'thumbs_up', active })); },
    remove,
    /** A thread this viewer just started: in the list (replacing any echo of it) and open. */
    added: (wire: AnnotationWire) => batch(() => {
      setAnnotations((prev) => [...prev.filter((item) => item.id !== wire.id), wire]);
      setOpenId(wire.id);
      setJustOpenedId(wire.id);
    }),
  };
}
