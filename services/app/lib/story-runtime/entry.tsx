/**
 * The served document's hydration entry (top-level for a reader, in the
 * owner's iframe) — bundled to public/story/entry-<hash>.js by
 * scripts/build-story-runtime.mjs and loaded as a crossorigin ES module at the
 * end of the document body. The author's Helmet <script> is parked inert
 * (AUTHOR_SCRIPT_TYPE) and transferred to an opaque child after hydration.
 * Author code never executes in the visible document's realm.
 *
 * Reads the JSON island the builder embedded and hydrates the SSR'd tree with
 * the SAME StoryRuntimeApp the server rendered — the island carries parsed
 * NODES, not source, so the runtime needs no JSX parser.
 */
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { StoryRuntimeApp } from './StoryRuntimeApp';
import {
  AUTHOR_SCRIPT_TYPE, STORY_ADOPTS_MESSAGE, STORY_ADOPT_HOOK, STORY_DATA_HOOK, STORY_DATA_MESSAGE, STORY_DOCUMENT_ACK_MESSAGE,
  STORY_HELLO_MESSAGE, STORY_ISLAND_ID, STORY_MODE_HOOK, STORY_READY_EVENT, STORY_ROOT_ID, STORY_SESSION_MESSAGE,
  STORY_EDIT_MODE_MESSAGE, isEditParentMessage, STORY_ANNOTATIONS_MESSAGE, STORY_SELECT_MESSAGE,
  STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, type StoryAnnotationsMessage, type StorySelectionActionsMessage,
  STORY_VALUES_HOOK, STORY_VALUES_MESSAGE, type StoryValuesMessage,
  type StoryDocumentUpdate, type StoryIslandData,
} from './contract';
import { capturePristine, type PristineChannel } from './pristine';
import type { FrameEditSession } from './edit/session';
import type { FrameAnnotateSession } from './edit/annotate';
import type { FrameSelectionActions } from './edit/selection-actions';
import { applyDocumentChrome, isStoryDocumentUpdate } from './document-update';
import { readerMode } from './reader-mode';
import { createDataflowStore, type DataflowStore } from './store';
import { installMx } from './mx';
import { createAuthorScriptSession } from './author-script';
import { createDocumentTransport } from './document-transport';
import { syncValuesToUrl } from './url-values-sync';
import { EMPTY_DATAFLOW } from '@/lib/story/dataflow';

/**
 * Run the author's Helmet <script>, which the builder parked in an inert
 * <script type="text/mx-author"> block. The code runs as a classic script in
 * an opaque child after hydration, never in this renderer's realm.
 */
let authorScriptRan = false;
let authorSession: ReturnType<typeof createAuthorScriptSession> | null = null;
function runAuthorScript(): void {
  if (authorScriptRan) return; // the commit signal and the failure path may both arrive
  authorScriptRan = true;
  document.dispatchEvent(new Event(STORY_READY_EVENT));
  for (const parked of document.querySelectorAll<HTMLScriptElement>(`script[type="${AUTHOR_SCRIPT_TYPE}"]`)) {
    // Failure is closed: author code never executes in the renderer's realm,
    // even when hydration or data-store initialization failed.
    if (!authorSession) continue;
    authorSession.replace(parked.textContent ?? '');
    parked.remove();
  }
}

const island = document.getElementById(STORY_ISLAND_ID);
const root = document.getElementById(STORY_ROOT_ID);
/*
 * THE ONE ORIGIN THIS DOCUMENT DEALS WITH, read from the runtime module's URL.
 *
 * The document itself has an OPAQUE origin, so it cannot ask where it lives —
 * but this module was fetched from the app, and (being `crossorigin`) it knows
 * its own absolute URL. That is already load-bearing: every dynamic import in
 * here resolves against it.
 *
 * Everything crossing the frame boundary is scoped to it — the edit channel
 * (pristine.ts) and the query relay (relay-transport.ts) alike — because both
 * directions matter: what a framer may TELL this document, and what this
 * document tells a framer.
 */
const appOrigin = new URL(import.meta.url).origin;

if (island?.textContent && root) {
  try {
    const data = JSON.parse(island.textContent) as StoryIslandData;
    // The document's data store, created HERE — before hydration and before
    // `mx:ready` — so the isolated script receives an initialized snapshot
    // and its bounded bridge operates on the runtime tree's own store.
    // Re-runs: inside a parent (the owner's shell) the relay posts to the
    // page, which calls /a/<id>/query with its session; top-level (the
    // reader's document) the document GETs its own `queryUrl` — its CSP
    // admits exactly that. Neither: values still change, tables stay.
    const transport = createDocumentTransport(window, data.queryUrl, appOrigin, undefined, data.mutateUrl);
    const store: DataflowStore = createDataflowStore(data.dataflow ?? { flow: EMPTY_DATAFLOW }, { transport });
    authorSession = createAuthorScriptSession(store);
    window.addEventListener('pagehide', event => {
      // A bfcache entry freezes its child and resumes it on restoration.
      if (!event.persisted) authorSession?.dispose();
    });
    /*
     * The asset verb, threaded to the view for the ONE consumer that needs it:
     * a bound `<img src="$pick">`, which cannot load the import endpoint for
     * itself inside a parent (opaque origin, no cookie). Present exactly when
     * the transport is the relay, so its presence IS "am I framed" — decided
     * once, above, like everything else about where this document talks.
     */
    const assetImport = transport?.importAsset
      ? { importAsset: (url: string) => transport.importAsset!(url) }
      : {};
    installMx(store);

    /*
     * WHEN THE FIRST RUN MAY GO OUT.
     *
     * Paint-first sends the declarations and no rows, so every document with
     * data starts by asking for it — and where it asks matters. Top-level, it
     * fetches its own queryUrl and nothing has to be ready but itself, so it
     * goes at once. Inside a parent it relays through the PAGE, and a message
     * posted before the page is listening is not queued anywhere: it is lost,
     * and the document then sits through the relay's 20s timeout with empty
     * charts. `mx:hello` from the page is the parent saying it is listening,
     * so that is the signal — with a fallback, because a document whose parent
     * never greets it must still fill in rather than stay blank forever.
     */
    const framed = window.parent && window.parent !== window;
    if (!framed) store.start();
    else setTimeout(() => store.start(), 2000);
    // The author script runs from the runtime's first-commit signal — the
    // hydrated tree exists only then (hydrateRoot merely schedules; a frame
    // later was still, sometimes, before the commit — and a script writing
    // text inside the root there handed React a hydration mismatch). The
    // timer is the safety net for a hydration that never commits: the SSR
    // markup is on screen and the script must still get to run against it.
    /*
     * THE CHANNEL THE AUTHOR'S SCRIPT CANNOT REACH (lib/story-runtime/pristine).
     *
     * Captured HERE, at module scope, before `runAuthorScript` injects the
     * author's code — that ordering is the whole security property, and it is
     * what lets this document send EDITS to the page at all. Every runtime →
     * parent message goes through it, not only edits: a shadowed
     * `window.parent` was measured swallowing 45 of the runtime's own posts.
     */
    let warnedOrigin = false;
    const channel: PristineChannel | null = capturePristine(window, appOrigin);
    /*
     * ANNOUNCED IN A BURST, AND ON REQUEST.
     *
     * The page's listener attaches when the PAGE hydrates, and this document
     * is small — it routinely finishes first. A single announcement is a burst
     * with an end, so a page that hydrates a moment later hears nothing at all
     * and drops every edit this document sends as unsigned. The same shape as
     * `mx:hello` for the paint signal: repeat briefly, and answer whoever asks.
     *
     * First announcement WINS at the page, which is what keeps this safe: the
     * runtime is what injects the author's script, so its first post is always
     * before any author code exists to imitate it.
     */
    if (channel) {
      const announceSession = () => channel.post({ type: STORY_SESSION_MESSAGE, nonce: channel.nonce });
      announceSession();
      /*
       * The first run goes out HERE, with the announcement — the moment this
       * document has a channel to its page at all.
       *
       * Not on `mx:hello`, which was the obvious signal and the wrong one: the
       * page greets on a timer only until the frame answers, and this
       * announcement is what answers, so the greeting usually stops before any
       * arrives. Waiting on it left every framed document's data to the
       * fallback timer below — two seconds of empty charts, measured.
       */
      store.start();
      let left = 12;
      const beat = setInterval(() => { announceSession(); if (--left <= 0) clearInterval(beat); }, 200);
      window.addEventListener('message', (event: MessageEvent) => {
        // A late greeting means the page missed us; answer, and make sure the
        // rows are on their way (start() is a no-op once they are).
        if (event.isTrusted && event.data === STORY_HELLO_MESSAGE) { announceSession(); store.start(); }
      });
    }

    /** The edit session, once the owner has entered edit mode. Never for a reader. */
    let edit: FrameEditSession | null = null;
    /** The annotate session, once the page has posted a pin set. Same never-for-a-reader shape. */
    let annotate: FrameAnnotateSession | null = null;
    /** View-mode selection chrome, loaded only when the parent grants at least one action. */
    let selectionActions: FrameSelectionActions | null = null;

    const renderApp = () => {
      edit?.setNodes(current.nodes);
      annotate?.setNodes(current.nodes);
      selectionActions?.setNodes(current.nodes);
      reactRoot.render(createElement(StoryRuntimeApp, {
        ...current,
        store,
        ...assetImport,
        ...(edit ? {
          editDecorate: edit.decorate,
          onSlideRename: (path: string, title: string) => edit?.renameSlide(path, title),
        } : {}),
      }));
    };

    /*
     * THE AUTHOR'S SCRIPT RUNS AT THE FIRST COMMIT, and paint-first changes
     * what it finds there: the rows are no longer inlined, so `mx.data.get()`
     * is empty for the moment it takes the document to fetch them. A script
     * that needs its rows subscribes (`mx.data.subscribe`), which skills/markup
     * now teaches.
     *
     * It was worth trying the other way — hold the script until the first run
     * settles, so nothing an author already wrote would notice. That coupling
     * is what makes it fragile: the page replaces a frame it thinks has died,
     * and in a fresh document "settled" is a round trip away, so the script
     * ran a second late or, if the answer went to the window that was
     * replaced, not at all. A script that runs when the document is ready is
     * worth more than a script that runs when the data is.
     */
    const reactRoot = hydrateRoot(root, createElement(StoryRuntimeApp, { ...data, store, ...assetImport, onMounted: runAuthorScript }));
    setTimeout(runAuthorScript, 3000);

    /*
     * ADOPTING A NEW VERSION OF THIS DOCUMENT.
     *
     * The page above holds the live stream — an opaque frame cannot open an
     * EventSource against the app's origin — and used to deliver what it heard
     * by replacing this frame outright: the document re-fetched, re-parsed and
     * re-hydrated, every chart rebuilt, the reader's place on the page and
     * their own selections gone, once per agent write. This document is a
     * React tree, so a newer version of it is a render.
     *
     * Only from our PARENT: any window can post here, and this decides what
     * the reader sees. `data` is carried forward so refData, chrome and the
     * query URL survive an update that does not mention them.
     */
    let current = data;

    /*
     * THE LINK FOLLOWS THE READER (lib/story-runtime/url-values-sync).
     *
     * A dashboard is only shareable if the address says what the reader
     * narrowed it to — and WHERE that address lives is the one thing that
     * differs by how this document is served. Top-level it is the reader's own
     * address bar, reached through the single narrow capability the history
     * prelude leaves open. Framed it is the FRAME's url, which nobody can see
     * or copy, so the choice is reported to the page instead and the page —
     * which holds the flow and the session — writes.
     *
     * The flow is asked for rather than captured: an agent's write replaces
     * the declarations under a document that is still open.
     */
    if (current.dataflow) {
      const values = (window as unknown as { [STORY_VALUES_HOOK]?: (p: Record<string, string | null>) => void })[STORY_VALUES_HOOK];
      syncValuesToUrl(
        store,
        () => current.dataflow?.flow ?? EMPTY_DATAFLOW,
        channel
          ? { post: (v) => channel.post({ type: STORY_VALUES_MESSAGE, nonce: channel.nonce, values: v } satisfies StoryValuesMessage) }
          : { hook: values ?? null },
      );
    }

    /**
     * The reader's mode override (the served document's toggle, wired by
     * anchor-entry). Seeded from the window.name envelope: the head prelude
     * has already stamped the class before first paint, and the render below
     * makes the chart ink agree — the SSR markup was drawn with the author's
     * mode, so an active override is a re-render, never a hydration input.
     */
    let readerOverride = readerMode(window);
    (window as unknown as Record<string, unknown>)[STORY_MODE_HOOK] = (mode: 'light' | 'dark') => {
      readerOverride = mode;
      current = { ...current, colorMode: mode };
      reactRoot.render(createElement(StoryRuntimeApp, { ...current, store, ...assetImport }));
    };
    if (readerOverride && readerOverride !== data.colorMode) {
      current = { ...current, colorMode: readerOverride };
      reactRoot.render(createElement(StoryRuntimeApp, { ...current, store, ...assetImport }));
    }

    /**
     * Adopting a new version of this document, whoever heard about it: the page
     * above (framed, see the message below) or the document's own live stream
     * (top-level, lib/story-runtime/live-entry). One implementation, two
     * callers. An active reader override outranks the frame's colorMode — the
     * author's default must not stomp the reader's choice on every write.
     */
    const adopt = (update: StoryDocumentUpdate) => {
      applyDocumentChrome(document, update, readerOverride);
      // Absent declarations mean the data did not change — replacing the flow
      // with an empty one would drop every table the reader is looking at.
      if (update.dataflow) store.replaceFlow(update.dataflow);
      if (update.authorScript !== undefined) authorSession?.replace(update.authorScript);
      current = {
        ...current,
        nodes: update.nodes,
        // MERGED, never replaced: an update names only refs the served
        // document lacked (an image just inserted while editing), and
        // replacing the map would strip every ref it already resolves.
        ...(update.refData ? { refData: { ...current.refData, ...update.refData } } : {}),
        // A flow-only update (a live frame) keeps the rows it has until the store re-runs them.
        ...(update.dataflow ? { dataflow: { flow: update.dataflow.flow, state: update.dataflow.state ?? current.dataflow?.state ?? { values: {}, tables: {}, errors: {} } } } : {}),
        ...(update.colorMode && !readerOverride ? { colorMode: update.colorMode } : {}),
      };
      // No onMounted: the script session above replaces only changed code;
      // unchanged code must not acquire duplicate subscriptions on prose edits.
      renderApp();
    };
    (window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK] = adopt;
    // …and the data twin, for the document's OWN stream when it is top-level
    // (lib/story-runtime/live-entry): re-run what reads the changed dataset.
    (window as unknown as Record<string, unknown>)[STORY_DATA_HOOK] = (datasets: string[]) => store.invalidateDatasets(datasets);
    // Tell the page above, if there is one, that updates can be delivered here
    // rather than around us. Repeated briefly because the page may still be
    // hydrating when this document finishes loading.
    if (channel) {
      let announced = 0;
      const announce = () => {
        // Through the CAPTURED channel like every other runtime → parent
        // message: `window.parent` is a replaceable property, and a shadowed
        // one was measured swallowing 45 of the runtime's own posts. This one
        // going missing means the page reloads the document to update it
        // instead of handing it the update — the exact repaint that all of
        // this exists to avoid.
        channel.post(STORY_ADOPTS_MESSAGE);
        if (++announced < 10) setTimeout(announce, 200);
      };
      announce();
    }
    /**
     * ENTERING AND LEAVING EDIT MODE — a mode this document enters, not a
     * different document. The chunk that carries the editing behaviour is
     * imported on demand, so a reader never downloads it.
     */
    let editLoading: Promise<void> | null = null;
    /**
     * Edit mode was ASKED FOR — true from the message, not from the moment the
     * chunk finishes loading. The annotation layer reads this to decide whether
     * a click belongs to the caret, and there is a real beat between the two:
     * a click on a commented paragraph in that beat was swallowed by the
     * annotation layer and opened its thread instead of placing the cursor.
     * Found by scripts/gate-annotations.
     */
    let editRequested = false;
    const setEditMode = (on: boolean) => {
      if (!channel) return;                       // no parent: nobody to edit for
      editRequested = on;
      if (!on) { edit?.dispose(); edit = null; renderApp(); return; }
      if (edit || editLoading) return;
      editLoading = import('./edit/session')
        .then(({ createFrameEditSession }) => {
          edit = createFrameEditSession({ win: window, channel, requestRender: renderApp });
          renderApp();
        })
        .catch((err) => { console.error('[story-runtime] edit mode failed to load:', err); })
        .finally(() => { editLoading = null; });
    };

    /**
     * ANNOTATION PINS — same lazy-chunk shape as edit mode: the module loads
     * on the first non-off message and a reader never downloads it (their
     * top-level document has no parent channel, so it cannot even arrive).
     * The message is the WHOLE state, so replaying the latest one after the
     * load races nothing.
     */
    let annotateLoading: Promise<void> | null = null;
    let lastAnnotations: StoryAnnotationsMessage | null = null;
    const setAnnotations = (message: StoryAnnotationsMessage) => {
      if (!channel) return;
      lastAnnotations = message;
      if (annotate) { annotate.update(message); return; }
      if (message.mode === 'off' || annotateLoading) return;
      annotateLoading = import('./edit/annotate')
        .then(({ createFrameAnnotateSession }) => {
          // `isEditing` is a live predicate, not a value: the edit session is
          // created and torn down independently, and the annotation layer must
          // read the CURRENT answer on every click it considers swallowing.
          annotate = createFrameAnnotateSession({ win: window, channel, isEditing: () => editRequested || !!edit });
          annotate.setNodes(current.nodes);
          if (lastAnnotations) annotate.update(lastAnnotations);
        })
        .catch((err) => { console.error('[story-runtime] annotations failed to load:', err); })
        .finally(() => { annotateLoading = null; });
    };

    /**
     * VIEW-MODE SELECTION ACTIONS — capability-gated by the authorized page.
     * A reader receives two false flags, which deliberately loads no chunk.
     */
    let selectionActionsLoading: Promise<void> | null = null;
    let lastSelectionActions: StorySelectionActionsMessage | null = null;
    const setSelectionActions = (message: StorySelectionActionsMessage) => {
      if (!channel) return;
      lastSelectionActions = message;
      if (selectionActions) { selectionActions.update(message); return; }
      if ((!message.edit && !message.annotate) || selectionActionsLoading) return;
      selectionActionsLoading = import('./edit/selection-actions')
        .then(({ createFrameSelectionActions }) => {
          selectionActions = createFrameSelectionActions({
            win: window,
            onAction: (action, selection) => channel.post({
              type: STORY_SELECTION_ACTION_MESSAGE, nonce: channel.nonce, action, selection,
            }),
          });
          selectionActions.setNodes(current.nodes);
          if (lastSelectionActions) selectionActions.update(lastSelectionActions);
        })
        .catch((err) => { console.error('[story-runtime] selection actions failed to load:', err); })
        .finally(() => { selectionActionsLoading = null; });
    };

    window.addEventListener('message', (event: MessageEvent) => {
      /*
       * Three things have to hold before this document takes an instruction.
       *
       * It must be a REAL event — a synthetic MessageEvent can spoof `source`,
       * so the author's script would otherwise be able to hand itself the
       * parent's authority (measured — seamless-editing-v2.md §3b).
       *
       * It must come from the window that FRAMES us, and from the app's own
       * ORIGIN. Whoever frames a document is its `window.parent`, and the
       * parent is who edit-mode, document replacement and selection come
       * from; the frame cannot tell one framer from another by looking, but
       * the browser stamps every message with its sender's origin. The
       * response's `frame-ancestors 'self'` says the same thing at the other
       * end — this is the half that does not depend on a header surviving a
       * proxy.
       */
      if (!event.isTrusted) return;
      if (!channel?.isFromParent(event)) {
        /*
         * Say so ONCE when the window that frames us is the one being refused.
         * A stranger's message is not worth a word, but a deployment serving
         * this runtime from another origin would refuse its OWN page — and
         * editing would simply do nothing, with nothing anywhere to say why.
         */
        if (event.source === window.parent && event.source !== window && !warnedOrigin) {
          warnedOrigin = true;
          console.warn(`[story-runtime] ignoring a message from ${event.origin}: this document takes instructions only from ${appOrigin}`);
        }
        return;
      }
      if (isStoryDocumentUpdate(event.data)) {
        adopt(event.data);
        channel.post(STORY_DOCUMENT_ACK_MESSAGE);
        return;
      }
      // A dataset under this document changed (the page heard it on the live
      // stream). No rows travel: the store re-runs the queries that read it
      // through the transport it already has, so there is one path for where
      // rows come from and it is the one the ACL already governs.
      const message = event.data as { type?: string; datasets?: unknown } | undefined;
      if (message?.type === STORY_DATA_MESSAGE && Array.isArray(message.datasets)) {
        store.invalidateDatasets(message.datasets as string[]);
        return;
      }
      if (!isEditParentMessage(event.data)) return;
      if (event.data.type === STORY_EDIT_MODE_MESSAGE) { setEditMode(event.data.on); return; }
      if (event.data.type === STORY_ANNOTATIONS_MESSAGE) { setAnnotations(event.data); return; }
      if (event.data.type === STORY_SELECTION_ACTIONS_MESSAGE) { setSelectionActions(event.data); return; }
      // A select-by-path (breadcrumb click) is meaningful to BOTH sessions;
      // each ignores it unless its own mode is active.
      if (event.data.type === STORY_SELECT_MESSAGE) annotate?.select(event.data.path);
      edit?.onParentMessage(event.data);
    });
  } catch (err) {
    // A failed hydration must never blank the document — the SSR markup is
    // already on screen and stays, and the author's script still runs against
    // it. Log for the gate's console check.
    console.error('[story-runtime] hydration failed:', err);
    runAuthorScript();
  }
} else {
  // No island (or no root) is not a reason to swallow the author's script.
  runAuthorScript();
}
