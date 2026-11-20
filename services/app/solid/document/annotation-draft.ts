/**
 * THE COMMENT BEING WRITTEN: what it is about, how that was picked, its words and its image, and sending it.
 *
 * `createCommentDraft` is one state machine. A PICK (Select outlines blocks and keeps text selection; Screenshot draws
 * an area) ends in a SELECTION, which opens the composer; saving or cancelling a comment that a Select started resumes
 * the Select. Opening the rail starts a pick, unless it opened for a thread, a composer is open, the page says not
 * (`pickOnOpen`) or it is a phone's sheet. Escape stands a pick down first, then cancels the composer. Page state,
 * never the URL.
 *
 * Interface: `selection`, `pick`, `words`/`setWords`, `failure`, `capture`, `image`, `screenshotUnavailable`;
 * `beginPick`, `endPick`, `toggleSelect`, `screenshot`; `receive` (a selection the document reports); `dismiss` and
 * `openRailForThread` (a thread is being opened instead); `submit`, `cancel`.
 */
import { batch, createEffect, createSignal, on, onCleanup, onMount, untrack, type Accessor } from 'solid-js';
import { isAreaRange } from '@/lib/document/annotation-range';
import { runtimeId } from '@artifactbin/utils/runtime-id';
import type { AnnotationWire } from '@/lib/annotations';
import { BackendRequestError, type ArtifactBackend } from '@/lib/artifact-backend';
import { hasReplyText } from '@/lib/annotations/remote-reply';
import { loginHref } from '@/lib/http/login-href';
import { COMMENT_TARGET_UNSAVED } from '@artifactbin/contracts/annotation-comment';
import type { StoryEditParentMessage, StoryEditSelection } from '@/lib/html-runtime/bridge/selection-contract';
import { createCommentCapture } from './CommentCapture';
import { createCommentImageDraft, preloadScreenshotEditor, type CommentImageAttachment } from './CommentImageAttach';
import { persistedText } from '../lib/draft-store';
import type { ThreadStore } from './annotation-threads';

export type CommentDraft = ReturnType<typeof createCommentDraft>;

/** What a re-report about the same node keeps from the selection it replaces. */
const KEPT = ['anchor', 'quote', 'range', 'viewState', 'viewStateError'] as const;

export function createCommentDraft(options: {
  artifactId: string;
  backend: ArtifactBackend;
  editId: () => string | undefined;
  /** The page's step before a comment is sent (AnnotationLayerProps.beforeComment). */
  beforeComment: () => ((subject: StoryEditSelection) => Promise<StoryEditSelection>) | undefined;
  mayCreate: () => boolean;
  threads: ThreadStore;
  rail: { open: Accessor<boolean>; set: (open: boolean) => void; pickOnOpen: Accessor<boolean>; phone: Accessor<boolean> };
  /** A selection handed down by the page, and telling it the composer now has it. */
  handed: Accessor<StoryEditSelection | null>;
  consumed: () => void;
  /** Where the document's viewport sits on the page (a framed document's iframe box). */
  frameOffset: () => { left: number; top: number } | undefined;
  post: (message: StoryEditParentMessage) => void;
  /** The document's Select was pressed before this code arrived. */
  pickRequested: boolean;
}) {
  const { backend, mayCreate, threads, rail, post } = options;
  /** Screenshots are stored by the backend; without that a comment carries none, and says why. */
  const imagesUnavailable = backend.unavailable('commentImages');
  const capture = createCommentCapture(backend, options.editId);
  // The composer's one image: the area tool's capture, or one pasted, dropped or attached. Retake is
  // for a capture; an attached image has nothing to retake.
  const image = createCommentImageDraft({ backend, editId: options.editId, capture,
    retake: () => (capture.draft()?.image.method === 'upload' ? undefined : () => void screenshot()) })!;
  let mutation = { signature: '', key: '' };
  const [selection, setSelection] = createSignal<StoryEditSelection | null>(null);
  const [pick, setPick] = createSignal<'block' | 'area' | null>(null);
  // Picking is suspended while its composer is open; finishing the draft resumes it.
  let resumeSelectAfterCompose = false;
  /** The rail is about to open FOR A THREAD (a pin, a marker): that opening must not start a pick. */
  let openedForThread = false;
  /** The sheet is being put away BY a pick (phone): that closing must not end it. */
  let sheetAwayForPick = false;
  // The composer's words, kept for this tab: after a reload they are back in the composer when it next opens.
  const [words, setWords] = persistedText(`${options.artifactId}:comment`);
  const [failure, setFailure] = createSignal<string | null>(null);

  const beginPick = (mode: 'block' | 'area') => {
    if (!mayCreate()) return;
    if (mode === 'block') capture.reset();
    setPick(mode);
    threads.focus(null);
    if (rail.phone() && untrack(rail.open)) {
      sheetAwayForPick = true;
      rail.set(false);
    }
  };
  const startPick = () => beginPick('block');
  const endPick = () => { resumeSelectAfterCompose = false; capture.reset(); setPick(null); };
  // Without tab capture (Firefox, Safari, plain http) the area tool still runs: the composer takes an uploaded image.
  const screenshotUnavailable = () => imagesUnavailable ?? (!options.editId() ? 'Screenshots need a saved document.' : null);
  const screenshot = async () => {
    if (!mayCreate()) return;
    if (screenshotUnavailable()) return;
    beginPick('area');
    const preparation = capture.start(); // Only this explicit gesture requests sharing.
    // The brush is its own chunk, preloaded now; native permission stays in the eager capture module so it keeps the gesture.
    void preloadScreenshotEditor().catch(() => {});
    if (await preparation === 'cancelled') beginPick('block');
  };

  /*
   * OPENING THE RAIL OPENS A PICK. Someone who presses "comments" is about to leave one. Closing the rail ends the pick
   * it opened, unless a pick is what put the sheet away. DECLARED BEFORE the handed-in selection below, so a rail
   * opening together with a selection ends with the composer, not the pick.
   */
  createEffect(on([rail.open, rail.pickOnOpen, rail.phone], ([isOpen, mayPick, phone]) => {
    const composing = untrack(selection) !== null;
    if (isOpen) {
      const forThread = openedForThread;
      openedForThread = false;
      if (!forThread && !untrack(options.handed) && !composing && mayPick && !phone) startPick();
      return;
    }
    if (sheetAwayForPick) { sheetAwayForPick = false; return; }
    if (untrack(pick) || !composing) capture.reset();
    setPick(null);
  }));
  createEffect(on(rail.pickOnOpen, (mayPick) => {
    if (mayPick) return;
    resumeSelectAfterCompose = false; setPick(null); capture.reset();
    if (!mayCreate()) setSelection(null);
  }));

  // A selection handed down by the page opens the composer on those exact words.
  createEffect(() => {
    const handed = options.handed();
    if (!handed) return;
    untrack(() => {
      resumeSelectAfterCompose = pick() === 'block';
      capture.reset();
      batch(() => { setSelection(handed); threads.focus(null); setFailure(null); setPick(null); });
      options.consumed();
    });
  });

  /** A selection the document reported: a pick's answer, or the composing node's geometry again. */
  const receive = (reported: StoryEditSelection | null) => {
    const picking = untrack(pick);
    if (picking) {
      // THE PICK'S ANSWER, and the pick is over either way. Null: escape in the document.
      resumeSelectAfterCompose = Boolean(reported) && picking === 'block';
      batch(() => {
        setPick(null);
        if (reported) {
          setSelection(reported);
          const rect = reported.captureRect ?? reported.rect;
          // The rect is in the document's viewport: the page's capture adds where that viewport sits (an inline
          // runtime's is the page's own, at 0,0; a framed document's is the iframe's box).
          const at = options.frameOffset();
          if (picking === 'area') void capture.capture({ ...rect, x: rect.x + (at?.left ?? 0), y: rect.y + (at?.top ?? 0) });
          threads.focus(null);
          setFailure(null);
        } else capture.reset();
      });
      return;
    }
    if (untrack(selection) === null || capture.draft() || capture.busy()) return;
    /*
     * The runtime re-reports the composing node's GEOMETRY on every scroll and re-render, with no
     * quote. The words survive a report about the SAME node only: widening to an ancestor is a
     * different subject, and a range addressed from the old anchor would not describe it.
     */
    batch(() => {
      setSelection((previous) => {
        if (JSON.stringify(previous) === JSON.stringify(reported)) return previous;
        const sameIdentity = reported?.nodeId && previous?.nodeId && reported.nodeId === previous.nodeId && reported.anchor?.ancestorId === previous.anchor?.ancestorId;
        if (!sameIdentity || reported?.range || reported?.anchor?.range || reported?.anchor?.quote) return reported;
        const merged = { ...reported, ...Object.fromEntries(KEPT.filter((key) => previous[key]).map((key) => [key, previous[key]])) };
        return JSON.stringify(previous) === JSON.stringify(merged) ? previous : merged;
      });
      setFailure(null);
      if (reported) threads.focus(null);
    });
  };

  const save = async () => {
    if (!mayCreate()) return;
    const picked = selection();
    if (!picked || !hasReplyText(words()) || capture.busy() || (capture.required() && !capture.draft())) return;
    if (!picked.nodeId && !picked.anchor) {
      // Never claims a save is pending: the layer cannot know one is. Say what is true either way.
      // A selection whose source element has no durable id: an element an edit just added, or one never identified.
      setFailure(COMMENT_TARGET_UNSAVED);
      return;
    }
    setFailure(null);
    await threads.working(async () => {
      try {
        const body = words();
        // Unsaved region text the comment quotes is saved first; the comment anchors to that version.
        const before = options.beforeComment();
        const subject = before ? await before(picked) : picked;
        const create = (attachment?: CommentImageAttachment) => {
          const signature = JSON.stringify([subject, body, attachment?.attachment_id]);
          if (mutation.signature !== signature) mutation = { signature, key: runtimeId() };
          // The exact words ride along when there are any; a caret comment carries neither key.
          return backend.createAnnotation({
            ...(subject.anchor ? { anchor: subject.anchor } : { node_id: subject.nodeId }), body,
            ...(attachment ?? {}),
            ...(!subject.anchor && subject.quote ? { quote: subject.quote } : {}),
            ...(subject.range && (!subject.anchor || isAreaRange(subject.range)) ? { range: subject.range } : {}),
            ...(subject.viewState ? { view_state: subject.viewState, edit_id: attachment?.edit_id ?? options.editId() } : {}),
          }, mutation.key);
        };
        let wire: AnnotationWire;
        try {
          // Staged and written together: an attached image follows a head that moved under it (CommentImageAttach `send`).
          wire = await image.send(create);
        } catch (error) {
          if (!(error instanceof BackendRequestError)) throw error;
          // A guest may READ a thread and may not start one: the login page, and back here with the ask.
          if (error.signInRequired) window.location.assign(loginHref(window.location, 'comment'));
          // The server holds no such element in the saved document (an edit not saved yet): the same true thing.
          else setFailure(error.code === 'bad_path' ? COMMENT_TARGET_UNSAVED : error.message);
          return;
        }
        capture.reset();
        const resume = resumeSelectAfterCompose;
        resumeSelectAfterCompose = false;
        batch(() => {
          threads.added(wire);
          setSelection(null);
          setWords('');
          if (resume) setPick('block');
        });
        if (!resume) post({ type: 'mx:select', path: null });
      } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not save the comment. Your draft is still here.'); }
    });
  };

  const cancel = () => {
    capture.reset();
    batch(() => { setSelection(null); setWords(''); setFailure(null); });
    if (resumeSelectAfterCompose) {
      resumeSelectAfterCompose = false;
      // The next annotation state clears the old target without a null-selection echo cancelling the new pick.
      startPick();
    } else post({ type: 'mx:select', path: null });
  };

  // ESCAPE, bound on the window while a pick or a composer is up: by the time someone reaches for it the focus may
  // be on the breadcrumb, the buttons, or the document behind. On the page it stands a pick down first, and the draft
  // stays (escape in the document arrives as a null selection); with no pick it cancels the composer.
  createEffect(() => {
    if (!pick() && !selection()) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (untrack(pick)) { capture.reset(); setPick(null); } else cancel();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  // A Select pressed while this code was arriving is started once, on arrival.
  onMount(() => { if (options.pickRequested && untrack(rail.pickOnOpen)) startPick(); });

  return {
    selection,
    pick,
    words,
    setWords,
    failure,
    capture,
    image,
    screenshotUnavailable,
    beginPick,
    endPick,
    toggleSelect: () => pick() === 'block' ? endPick() : beginPick('block'),
    screenshot,
    receive,
    /** A thread is being opened: no pick, no capture, no composer. */
    dismiss: () => { capture.reset(); setPick(null); setSelection(null); },
    /** The rail opens for a thread, so its opening starts no pick. */
    openRailForThread: () => { if (!untrack(rail.open)) openedForThread = true; rail.set(true); },
    submit: () => {
      if (!mayCreate()) return;
      if (threads.busy() || !hasReplyText(words())) return;
      void save();
    },
    cancel,
  };
}
