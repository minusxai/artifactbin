// @ts-check
import {createRemoteAccess} from "./remote-access.ts";
import { createImageHost } from "./image-host.ts";
import { createCommentAttachmentResources } from "./comment-attachment-resources.ts";
import { readPlatformImage, platformImageBlob } from "./platform-image.ts";
import { supplementalAddress } from "../media/supplemental-address.ts";
import { createDocumentHost } from "./document-host.ts";
import { validateSelection } from "../domain/selection-presence.ts";
import { commentAccess, prepareComment } from "./comment-command.ts";
import { createPlatformChrome } from "./platform-chrome.ts";
import { drawCursorLayer } from "./cursor-layer.ts";
import { createCommentPanel } from "./comment-panel.ts";
import { admitAppMessage } from "./app-message-routing.ts";
import { createConnectionCoordinator } from "./connection-coordinator.ts";
import { installLocalLayout } from "./local-layout.ts";
import { readBoundedJSON } from "./bounded-response.ts";
import { createRemoteHost } from "./remote-host.ts";
import { createPlatformStatus } from "./platform-status.ts";
import { openAccount } from "./account.js";
import { viewerAppearance } from "./identity.js";
import { openSharing } from "./sharing.js";
import {
  createCollaborationTransport,
  createBrokerCollaborationTransport,
} from "./collaboration-transport.ts";
import { createReaderPreferences } from "./reader-preferences.ts";
import { createPresenceScheduler } from "./presence-scheduler.ts";
import { createDocumentView } from "./document-view.ts";
import { createDocumentSave } from "./document-save.ts";
import { publicationGate } from "./lifecycle.ts";
import { createDocumentActivity, settleActivityCallbacks } from "./activity.ts";
import { createCollaborationSession } from "./collaboration-session.ts";
import { localChromeCSS } from "./ui-style.js";
import { createPlatformClient } from "./platform-client.ts";
import { openDocument } from "./document-session.js";
import { createPlacement, PAGE_FRAME_SANDBOX } from "./placement.js";
import { withState } from "./core/standalone.ts";
import { readStateFragment } from "../apollo/state-url.ts";
async function bootPlatform() {
  const documentSession = await openDocument();
  const { source, hosted, shell, local } = documentSession;
  const trustedConnection = local ? null : window.__pagegiTrustedConnection;
  let saved = documentSession.state,
    preview = documentSession.preview;
  /** State from the address's #af-state: handed to the page once, on its first mount. */
  let loadState = documentSession.load;
  const gate = publicationGate();
  const sessionId = crypto.randomUUID();
  /** A downloaded file's identity: the server it came from, its ID, version and revision. */
  const localPage = local ? documentSession.page : null;
  const authorAccess=createRemoteAccess();
  /** @type {import('../apollo/apollo-contracts.ts').RemoteAccessSnapshot['state']} */
  let authorAccessState='pending';
  const host = createDocumentHost({
    invalidateCollaboration: () => { authorAccessState='pending';sendApp({pagegi:true,kind:'authorization-context',context:null,access:authorAccess.invalidate()});imageHost.invalidate(); attachmentResources.setAuthority(null); collaboration.disconnect(); },
    readState: () => saved,
    updateState: (reducer) => { saved = reducer(saved); },
    // A downloaded file comments as the hosted view does: signed in, with the server's permission.
    gate, source, sessionId, local, hosted: !!hosted || local,
    ...(hosted && Number.isSafeInteger(hosted.version) ? { version: hosted.version } : {}),
    ...(localPage ? { version: localPage.version } : {}),
    previewToken: preview?.token, origin: location.origin, documentPath: location.pathname,
    initial: { session: hosted?.token || null, username: hosted?.username || null, permissions: hosted?.permissions || null },
  });
  let pageCached = false;
  /** @type {import("./lifecycle-contracts.ts").AppSurface | undefined} */
  let placement;
  function sendApp(data) {
    placement?.send(data);
  }
  function authorizationContext() {
    const current = host.read();
    return gate.active && !documentView.historical && authorAccessState === "allowed"
      ? current.permissions?.authorizationContext ?? null : null;
  }
  function sendAuthorizationContext() {
    if(!authorizationContext())imageHost.invalidate();
    const context=authorizationContext();
    const access=authorAccess.project({active:gate.active,historical:documentView.historical,phase:authorAccessState,context});
    sendApp({pagegi: true, kind: "authorization-context", context:access.context,access});
  }
  const localLayout = local
    ? installLocalLayout({ document, inset: 44 })
    : null;
  addEventListener("pagehide", (event) => {
    if (!event.persisted) localLayout?.dispose();
  });
  const style = document.createElement("style");
  style.textContent = local ? localChromeCSS(PAGEGI_CSS) : PAGEGI_CSS;
  style.dataset.pagegiUi = "";
  document.head.append(style);
  const chrome = createPlatformChrome({
    read: () => ({
      actor: host.read().username,
      profiles: saved.profiles || {},
      viewers: host.read().viewers,
      sessionId,
      remote: !!saved.remote,
      connected: !!host.read().session,
      canComment: canComment(),
      preferences,
    }),
    act: chromeAction,
    beginAction: () => platformStatus.clearNotice(),
    error: (message) => platformStatus.notice(message),
  });
  const bar = chrome.bar;
  const frame = /** @type {HTMLIFrameElement} */ (
    document.getElementById("pg-frame") || document.createElement("iframe")
  );
  frame.id = "pg-frame";
  frame.title = "Document";
  frame.setAttribute("sandbox", PAGE_FRAME_SANDBOX);
  frame.hidden = local;
  const historyFrame = document.createElement("iframe");
  historyFrame.id = "pg-history";
  historyFrame.title = "Static saved view";
  historyFrame.hidden = true;
  historyFrame.sandbox = "";
  historyFrame.dataset.pagegiUi = "";
  historyFrame.style.cssText =
    "position:fixed;inset:44px 0 0;width:100%;height:calc(100% - 44px);border:0;background:white;z-index:5";
  const layer = document.createElement("div");
  layer.id = "pg-layer";
  const cursorLayer = document.createElement("div");
  cursorLayer.id = "pg-cursors";
  for (const el of [bar, frame, layer, cursorLayer]) el.dataset.pagegiUi = "";
  document.body.append(
    bar,
    ...(local ? [] : [frame]),
    historyFrame,
    layer,
    cursorLayer,
  );

  let cursor = null, selection = null;
  const readerPreferences = createReaderPreferences(() => localStorage);
  const preferences = readerPreferences.read();
  const documentView = createDocumentView({
    source,
    revision: saved.sourceRevision,
    snapshot: saved.app,
    contextOnly: saved.contextOnly,
    contexts: {
      cached: () => ({ sources: saved.sources, snapshots: saved.snapshots }),
      comment: (id) => collaboration.readContext({ kind: "context.get", id }),
      viewer: (sessionId) =>
        collaboration.readContext({ kind: "presence.capture", sessionId }),
    },
    surface: {
      mount,
      suspend: () => sendApp({ pagegi: true, kind: "suspend" }),
    },
    activity: {
      suspend: (reason) => activity.suspend(reason),
      resume: (reason) => activity.resume(reason),
    },
    changed(change) {
      if (change.kind !== "live") selection = null;
      if (change.kind === "live") {
        if (change.snapshotChanged) {
          // A hosted viewer's local state lives in their browser: nothing to save.
          if (preview) touch();
          else info();
          schedulePresence();
        }
      } else {
        commentPanel.close();
        chrome.showReturn(change.kind === "history");
        info(
          change.kind === "saved-context"
            ? "Saved context — read-only, with scripts and networking disabled."
            : "",
        );
      }
      draw();
    },
  });
  function approvalLink(url) {
    chrome.showApproval(url);
  }
  const connection = createConnectionCoordinator({
    local,
    gate,
    trusted: trustedConnection,
    binding: host.connectionBinding,
    createClient: createPlatformClient,
    openPopup() {
      const popup = window.open(
        "about:blank",
        "pagegi-connect",
        "width=480,height=620",
      );
      return (
        popup && {
          navigate: (url) => {
            popup.location.href = url;
          },
          close: () => popup.close(),
        }
      );
    },
    approveLink: approvalLink,
    onEvent: (event) => {
      if (event.type !== "pairing")
        brokerTransport.event(event);
    },
    apply(value) {
      if (host.applyConnection(value).publicationChanged) touch();
      chrome.showConnect(false);
      updateIdentity();
    },
    async connected() {
      // Now as the account: a private page opens, and the server's permissions and version are known.
      await openPage();
      startLive();
      await sync();
    },
  });
  const broker = (origin) => connection.broker(origin);
  /** The server's version of a downloaded file's page, once the page was opened through the frame. */
  let serverVersion = null,
    pageOpened = false;
  function versionNotice() {
    return localPage && serverVersion !== null && serverVersion > localPage.version
      ? `A newer version of this page (${serverVersion}) is on the server; this file is version ${localPage.version}. Open it from Documents.`
      : "";
  }
  /**
   * A downloaded file reads its page through the platform frame: as nobody
   * (an unlisted page), or as the connected account. The frame keeps the link
   * capability and the grant; the document gets comments, profiles, permissions
   * and the server's version.
   */
  async function openPage() {
    if (!localPage) return;
    try {
      const page = await broker().page();
      serverVersion = page.boot.version;
      const first = !pageOpened;
      pageOpened = true;
      saved = {
        ...saved,
        profiles: page.state.profiles || {},
        sources: page.state.sources || {},
        ...(first ? { comments: page.state.comments } : {}),
      };
      updateIdentity();
      drawPeople();
      draw();
    } catch (error) {
      // A private page before Connect, or no server: the file keeps working on its own.
      if (!pageOpened) info(error instanceof Error && /invitation|access/i.test(error.message) ? "Connect to open this page's comments." : "");
    }
  }
  /** The viewer's page grant (or the link's read capability), never an account token. */
  function backendHeaders() {
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json" };
    try {
      const { token } = host.transportConnection();
      if (token) headers.Authorization = "Bearer " + token;
    } catch {}
    return headers;
  }
  // Backend calls from the page: POST /api/files/:id/graphql with the viewer's own page grant
  // (a downloaded file sends them through its platform frame, which holds that grant).
  const imageHost = createImageHost({
    pageId:()=>saved.fileId||null,
    authority:authorizationContext,
    async load(address,context,signal){
      if(local)return broker().image(address,context,signal);
      return readPlatformImage(await fetch(supplementalAddress(address),{method:"GET",credentials:"same-origin",redirect:"error",headers:backendHeaders(),signal}),signal);
    },
    reply:response=>sendApp({pagegi:true,kind:"image-response",response}),
  });
  const remoteHost = createRemoteHost({
    authorizationContext,
    endpoint: () =>
      saved.fileId
        ? `/api/files/${encodeURIComponent(saved.fileId)}/graphql`
        : null,
    active: () => gate.active && !documentView.historical,
    online: () => navigator.onLine,
    async post(url, body, expectedContext) {
      if (local) return broker().backend("graphql", "POST", body, expectedContext);
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: backendHeaders(),
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await readBoundedJSON(response, 2 * 1024 * 1024).catch(
          () => null,
        ),
      };
    },
    reply: (response) =>
      sendApp({ pagegi: true, kind: "remote-response", response }),
  });
  function suspendBackend() {
    connection.cancel();
  }
  /** The live session's current message, kept across publications that carry none. */
  let sessionMessage = "";
  const platformStatus = createPlatformStatus({
    read: () => ({
      hosted: !!hosted,
      preview: !!preview,
      remote: !!saved.remote,
      historical: documentView.historical,
      fileDirty: saver.status.dirty,
      pendingComments: saved.pending.length,
      drafts: commentPanel.drafts,
      sync: host.read().sync,
      sessionMessage,
    }),
    render(label, status) {
      chrome.setStatus(label);
      sendApp({ pagegi: true, kind: "status", status });
    },
    onObserverError: (error) => console.error("Status observer failed", error),
  });
  function shouldWarn() {
    return platformStatus.read().dirty;
  }
  function status() {
    return platformStatus.read();
  }
  function info(text = "") {
    platformStatus.publish(text || versionNotice());
  }
  const saver = createDocumentSave({
    capture: envelope,
    etag: preview?.etag,
    write: preview
      ? async ({ snapshot, etag, signal }) => {
          if (!etag) throw Error("Preview save revision is missing");
          const response = await fetch("/state", {
            method: "PUT",
            signal,
            headers: {
              Authorization: "Bearer " + preview.token,
              "Content-Type": "application/json",
              "If-Match": etag,
            },
            body: JSON.stringify(snapshot),
          });
          const result = await response.json();
          if (!response.ok)
            throw Error(result.error + " Use Download HTML in Page settings.");
          return { etag: result.etag };
        }
      : undefined,
    download: () => download(),
    onChange: () => info(),
    onError: (error) => info(error.message),
  });
  function touch() {
    // A downloaded file keeps nothing but its state; comments live on the server.
    if (!local) saver.touch();
  }

  function envelope() {
    return documentView.envelope(saved);
  }
  /**
   * The server writes the file (the page with the core inlined); this viewer's
   * own local state replaces the published starting state in it.
   */
  function download() {
    if (local) {
      // The file saves itself with its current state, as its own control does offline.
      sendApp({ pagegi: true, kind: "download" });
      info("Download started — keep the downloaded file to preserve changes.");
      return "download-started";
    }
    const url = new URL(location.href);
    url.search = "?download=1";
    url.hash = "";
    const name =
      (hosted?.path
        ?.split("/")
        .at(-1)
        ?.replace(/\.html$/i, "") ||
        document.title
          .replace(/[^a-z0-9 _-]/gi, "")
          .trim()
          .slice(0, 80) ||
        "pagegi") + ".html";
    const state = documentView.historical
      ? null
      : documentView.snapshot?.state || null;
    void (async () => {
      const response = await fetch(url.href, { credentials: "same-origin" });
      if (!response.ok) throw Error("Download failed");
      const html = await response.text();
      const file = new Blob([state ? withState(html, state) : html], {
        type: "text/html",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    })().catch((error) => info(error.message));
    info("Download started — keep the downloaded file to preserve changes.");
    return "download-started";
  }
  function save() {
    return saver.save();
  }

  function mount(source, snapshot, revision, history = false) {
    placement ??= createPlacement({
      local,
      shell,
      frame,
      historyFrame,
      localState() {
        const load = loadState;
        loadState = null;
        return { page: saved.fileId || "", seed: documentSession.seed, load };
      },
      viewer: viewerAppearance,
      bridge: PAGEGI_BRIDGE,
      designSystem: documentSession.designSystem ?? null,
      designSystemCss,
    });
    placement.mount(source, snapshot, revision, history);
  }

  /** @param {string} href */
  function inlineCss(href) {
    const prefix = "data:text/css;base64,";
    if (!href.startsWith(prefix)) return null;
    const bytes = Uint8Array.from(atob(href.slice(prefix.length)), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  /**
   * A design system's CSS for a saved view: the page's own from what the
   * server sent with it (or, in a downloaded file, its inline link), any
   * other from the platform.
   * @param {string} name
   */
  async function designSystemCss(name) {
    const own = documentSession.designSystem;
    if (own?.name === name) return inlineCss(own.href);
    if (local) {
      const link = document.querySelector('link[data-af="design-system"]');
      return link instanceof HTMLLinkElement &&
        document.documentElement.getAttribute("data-af-design-system") === name
        ? inlineCss(link.href)
        : null;
    }
    const response = await fetch(`/af/v1/design-systems/${encodeURIComponent(name)}.css`);
    return response.ok ? response.text() : null;
  }
  function mode(on) {
    sendApp({ pagegi: true, kind: "mode", on });
  }
  const collaboration = createCollaborationSession({
    gate,
    readState: () => saved,
    authenticated: () => !!host.read().session,
    contextReadsAllowed: () =>
      documentView.historical && !saved.contextOnly && !pageCached,
    updateState(reducer, change) {
      const before = saved;
      saved = reducer(saved);
      if (
        change === "comments" &&
        (JSON.stringify(before.comments) !== JSON.stringify(saved.comments) ||
          JSON.stringify(before.pending) !== JSON.stringify(saved.pending))
      )
        touch();
      if (change === "profiles") {
        updateIdentity();
        drawPeople();
      }
      draw();
    },
    onReady() {
      sendPresence();
      sendApp({ pagegi: true, kind: "remote-invalidated" });
    },
    onInvalidated() {
      attachmentResources.setAuthority(null);
      sendApp({ pagegi: true, kind: "remote-invalidated" });
    },
    onAcknowledged: (from, to) => commentPanel.rename(from, to),
    onChange(next) {
      authorAccessState=next.access??(next.sync==='synced'?'allowed':next.sync==='error'?'disconnected':'pending');
      const change = host.observeCollaboration(next);
      refreshAttachmentAuthority();
      sendAuthorizationContext();
      if (change.rosterChanged) drawPeople();
      drawCursors();
      if (change.permissionsChanged) draw();
      // A downloaded file cannot reload into the newer version: it reads the
      // server's version again and its own notice names both.
      if (local && /newer version/i.test(next.message)) {
        sessionMessage = "";
        void openPage().then(() => info());
      } else {
        sessionMessage = next.message;
        info();
      }
    },
  });
  /** @returns {import("./comment-command-contracts.ts").CommentAccessInput} */
  const commentAccessInput = host.commentAccess;
  const canComment = () => commentAccess(commentAccessInput()).allowed;
  const commentNotice = () => commentAccess(commentAccessInput()).notice;
  /** @param {string} body @param {import("./comment-panel-contracts.ts").CommentSelection} pick @param {string|null} parentId */
  function addComment(body, pick, parentId = null) {
    const result = prepareComment(
      saved,
      { body, selection: pick, parentId },
      {
        access: commentAccessInput(),
        sourceRevision: documentView.revision,
        connected: !!host.read().session,
        now: Date.now(),
        id: () => crypto.randomUUID(),
      },
    );
    saved = result.state;
    touch();
    if (result.synchronize) sync().catch((e) => info(e.message));
    return result.id;
  }
  function drawCursors() {
    sendApp({
      pagegi: true,
      kind: "selections",
      viewers:
        preferences.showSelections &&
        gate.active &&
        !documentView.historical &&
        host.read().sync === "synced"
          ? host.read().viewers
              .filter(
                (v) =>
                  v.sessionId !== sessionId &&
                  v.sourceRevision === documentView.revision,
              )
              .map((v) => ({
                actor: String(v.actor).slice(0, 100),
                selection: validateSelection(v.selection),
              }))
          : [],
    });
    drawCursorLayer(
      cursorLayer,
      preferences.showCursors
        ? {
            viewers: host.read().viewers,
            actor: host.read().username,
            sessionId,
            sourceRevision: documentView.revision,
            targets: documentView.targets,
            width: innerWidth,
            inset: bar.offsetHeight,
          }
        : null,
    );
  }
  const attachmentResources = createCommentAttachmentResources({
    async load(commentId,attachmentId,variant,signal) {
      const current=host.read(),context=current.permissions?.authorizationContext;
      if(!saved.fileId||current.sync!=="synced"||!current.permissions?.read||!context)throw Object.assign(Error("Image unavailable"),{status:403});
      const address={kind: /** @type {const} */ ("comment"),pageId:saved.fileId,commentId,attachmentId,variant};
      signal.throwIfAborted();
      const value=local?await broker().image(address,context,signal):await readPlatformImage(await fetch(supplementalAddress(address),{method:"GET",credentials:"same-origin",redirect:"error",headers:backendHeaders(),signal}),signal);
      signal.throwIfAborted();
      if(host.read().permissions?.authorizationContext!==context||host.read().sync!=="synced")throw Object.assign(Error("Image caller changed"),{status:403});
      return platformImageBlob(value);
    },
    maxBytes:4*1024*1024,
    createURL:blob=>URL.createObjectURL(blob),
    revokeURL:url=>URL.revokeObjectURL(url),
  });
  function refreshAttachmentAuthority(){
    const current=host.read();
    attachmentResources.setAuthority(gate.active&&current.sync==="synced"&&current.permissions?.read?current.permissions.authorizationContext??null:null);
  }
  const commentPanel = createCommentPanel({
    attachmentResources,
    layer,
    read: () => ({
      comments: saved.comments,
      profiles: saved.profiles || {},
      sourceRevision: saved.sourceRevision,
      actor: host.read().username,
      snapshot: documentView.snapshot,
      canComment: canComment(),
      notice: commentNotice(),
      canResolve: !!host.read().session,
      live: !documentView.historical,
    }),
    geometry: () => ({
      targets: documentView.targets,
      inset: bar.offsetHeight,
      height: innerHeight,
    }),
    actions: {
      post: addComment,
      async resolve(comment) {
        if (comment.revision === undefined)
          throw Error("Sync this comment before resolving it");
        await collaboration.resolveComment(comment.id, comment.revision);
        touch();
      },
      async reopen(comment) {
        if (comment.revision === undefined)
          throw Error("Sync this comment before reopening it");
        await collaboration.resolveComment(comment.id, comment.revision, false);
        touch();
      },
      view: viewComment,
      finishSelection: () => mode(false),
      error: info,
    },
  });
  function draw() {
    refreshAttachmentAuthority();
    drawCursors();
    commentPanel.render();
  }
  function closeComment() {
    commentPanel.close();
  }
  function viewComment(comment) {
    return documentView.showComment(comment);
  }
  function returnOwn() {
    documentView.returnLive();
  }
  function currentPresence() {
    return {
      sessionId,
      sourceRevision: saved.sourceRevision,
      snapshot: preferences.shareView ? documentView.snapshot : null,
      cursor,
      selection:
        preferences.shareSelection && gate.active && !documentView.historical
          ? selection
          : null,
      ...preferences,
    };
  }
  const presence = createPresenceScheduler({
    read: () => ({
      authenticated: !!host.read().session,
      active: gate.active,
      presence: currentPresence(),
    }),
    publish: (value) => collaboration.publishPresence(value),
    publishCursor: (value) => collaboration.publishCursor(value),
  });
  function sendPresence() {
    presence.send();
  }
  function schedulePresence() {
    presence.schedule();
  }
  const brokerTransport = createBrokerCollaborationTransport({
    client: broker,
    binding: () => ({ sessionId, sourceRevision: saved.sourceRevision }),
    presence: currentPresence,
  });
  const httpTransport = createCollaborationTransport({
    sessionId,
    connection: host.transportConnection,
  });
  function startLive() {
    // A downloaded file goes live once its page opened through the frame (a private page: after Connect).
    if (saved.remote && gate.active && (!local || pageOpened))
      collaboration.attach(local ? brokerTransport : httpTransport);
  }
  addEventListener("online", () => {
    if (saved.remote) startLive();
  });
  const activity = createDocumentActivity([
    collaboration,
    saver,
    {
      suspend() {
        suspendBackend();
        presence.cancel();
      },
      resume() {},
      dispose() {
        settleActivityCallbacks(
          [
            () => suspendBackend(),
            () => documentView.dispose(),
            () => commentPanel.dispose(),
            () => attachmentResources.dispose(),
            () => imageHost.invalidate(),
            () => chrome.dispose(),
            () => connection.dispose(),
            () => presence.cancel(),
          ],
          "dispose",
        );
      },
    },
  ]);
  addEventListener("pagehide", (event) => {
    pageCached = event.persisted;
    if (event.persisted) activity.suspend("page-cache");
    else activity.dispose();
  });
  addEventListener("pageshow", (event) => {
    pageCached = false;
    if (event.persisted) activity.resume("page-cache");
  });
  function sync() {
    return collaboration.synchronize();
  }
  async function connect(origin) {
    if (!saved.remote && !origin) {
      chrome.promptConnection();
      return;
    }
    chrome.close();
    await connection.connect(origin);
  }
  function drawPeople() {
    chrome.renderPeople();
  }
  function updateIdentity() {
    refreshAttachmentAuthority();
    sendAuthorizationContext();
    chrome.renderIdentity();
  }
  function closePopover(focus = false) {
    chrome.close(focus);
  }
  /** @param {import("./platform-chrome-contracts.ts").ChromeAction} action */
  async function chromeAction(action) {
    switch (action.kind) {
      case "connect":
        return connect(action.origin);
      case "return":
        return returnOwn();
      case "account":
        // The website session is only usable on the server itself, so a downloaded file opens it there.
        if (local && saved.remote)
          window.open(saved.remote.origin + "/?account=1", "_blank", "noopener");
        else if (saved.remote)
          openAccount(saved.remote.origin, async () => {
            if (host.read().session) await collaboration.refreshProfiles();
          });
        return;
      case "share":
        if (local && saved.remote)
          window.open(
            saved.remote.origin + "/?sharing=" + encodeURIComponent(saved.fileId || ""),
            "_blank",
            "noopener",
          );
        else if (saved.remote) openSharing(saved.remote.origin, saved.fileId);
        return;
      case "add-comment":
        mode(true);
        info("Choose something to comment on, or right-click it.");
        return;
      case "disconnect":
        sendApp({pagegi: true, kind: "authorization-context", context: null});
        trustedConnection?.cancel();
        collaboration.disconnect();
        host.disconnectIdentity();
        await connection.disconnect();
        startLive();
        chrome.showConnect(true);
        updateIdentity();
        info();
        return;
      case "download":
        download();
        return;
      case "library":
        if (hosted) location.href = hosted.home;
        else if (saved.remote)
          window.open(saved.remote.origin, "_blank", "noopener");
        return;
      case "view-person":
        return documentView.showViewer(action.sessionId);
      case "theme":
      case "design-system":
        sendApp({ pagegi: true, kind: "appearance", viewer: viewerAppearance() });
        return;
      case "preference":
        Object.assign(preferences, readerPreferences.set(action.key, action.value));
        draw();
        sendPresence();
        return;
      case "comment-context":
        if (!canComment() && !host.read().username) return connect();
        openComposer(action.selection);
        return;
      case "page-comment":
        if (!canComment() && !host.read().username) return connect();
        mode(false);
        openComposer({ nodeId: null, quote: "", snapshot: documentView.snapshot });
        return;
    }
  }
  function openComposer(m) {
    commentPanel.open({
      nodeId: m.nodeId,
      quote: m.quote,
      snapshot: m.snapshot || null,
    });
  }
  chrome.setTheme(chrome.theme, false);
  updateIdentity();
  frame.addEventListener("load", () => chrome.setTheme(chrome.theme, false));
  addEventListener("pointerdown", (e) => {
    if (e.target instanceof Node) {
      commentPanel.dismissOutside(e.target);
      chrome.dismissOutside(e.target);
    }
  });
  /** @type {import("./app-message-routing-contracts.ts").AppMessageRouting<MessageEvent>} */
  const appMessageRouting = {
    accepts: (event) => placement?.accepts(event) === true,
    active: () => gate.active,
    backend: (message) => imageHost.handle(message)||remoteHost.handle(message),
  };
  addEventListener("message", (e) => {
    if (!admitAppMessage(e, appMessageRouting)) return;
    const m = e.data;
    try {
      if (m.kind === "view") {
        sendAuthorizationContext();
        documentView.receiveView(m);
        // The loading screen lifts once the page is styled, never before its design system's CSS.
        if (!local && m.styled !== false) dispatchEvent(new Event("pagegi-startup-ready"));
      }
      if (m.kind === "dismiss") {
        chrome.hideContext();
        closePopover();
        if (!layer.querySelector("textarea")?.value.trim()) closeComment();
      }
      if (m.kind === "context")
        chrome.context(
          { nodeId: m.nodeId, quote: m.quote, snapshot: m.snapshot },
          m.x,
          m.y,
        );
      if (m.kind === "pick") {
        openComposer(m);
      }
      if (m.kind === "selection") {
        selection = validateSelection(m.selection);
        presence.selection();
      }
      if (m.kind === "cursor") {
        cursor = m.cursor;
        presence.cursor();
      }
      if (m.kind === "save")
        save()
          .then((result) =>
            sendApp({ pagegi: true, kind: "saved", id: m.id, result }),
          )
          .catch((error) =>
            sendApp({
              pagegi: true,
              kind: "saved",
              id: m.id,
              error: error.message,
            }),
          );
      if (m.kind === "error") info("App error: " + m.message);
    } catch (error) {
      info(error instanceof Error ? error.message : String(error));
    }
  });
  addEventListener("resize", draw);
  // `#af-state=` pasted into an open page: load it the same way as on open.
  addEventListener("hashchange", () => {
    if (readStateFragment(location.hash).found) location.reload();
  });
  addEventListener("focus", () => {
    if (saved.remote) collaboration.refreshProfiles().catch(() => {});
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      chrome.hideContext();
      commentPanel.close();
      layer.replaceChildren();
      closePopover(true);
      mode(false);
      draw();
    }
  });
  addEventListener("beforeunload", (e) => {
    if (shouldWarn()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.pagegi = Object.freeze({
    save,
    getStatus: status,
    subscribeStatus: platformStatus.subscribe,
  });
  async function start() {
    if (saved.contextOnly) {
      for (const child of [...document.body.children])
        if (!child.hasAttribute("data-pagegi-ui")) child.remove();
      chrome.showConnect(false);
      chrome.showReturn(false);
      if (!local)
        historyFrame.addEventListener(
          "load",
          () => {
            dispatchEvent(new Event("pagegi-startup-ready"));
          },
          { once: true },
        );
      documentView.start();
      return;
    }
    documentView.start();
    info();
    if (saved.remote) {
      chrome.showLibrary(true);
      if (host.read().session) {
        chrome.showConnect(false);
        updateIdentity();
      }
      await openPage();
      startLive();
    }
  }
  await start();
}
bootPlatform().catch((error) => {
  console.error(error);
  if (document.getElementById("pg-startup")) {
    dispatchEvent(new Event("pagegi-startup-failed"));
    return;
  }
  const notice = document.createElement("p");
  notice.dataset.pagegiUi = "";
  notice.setAttribute("role", "alert");
  notice.textContent = "Pagegi could not start: " + error.message;
  document.body?.append(notice);
});
