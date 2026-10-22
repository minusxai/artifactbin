// The page-side half of a hosted page, installed by the runner before the
// page's own HTML. It registers the CoreHost the core uses for the viewer's
// own local state (kept in this browser, keyed by the page), backend calls
// and the viewer's appearance, and reports views, selections,
// cursors and comment targets (by data-af-id) to the platform frame. Nothing
// here holds a credential: every effect is a message to the platform.
// In a downloaded file (`boot.local`) the platform runtime installs it in the
// page's own realm after the core has started: it then attaches the same host
// to the running core and uses the core's state store.
import { captureSelection, paintSelections } from "./selection-presence.ts";
import { persistentStore, viewerStateKey } from "./core/standalone.ts";
import { createRemoteClient } from "./remote-client.ts";
import { captureRenderedDocument } from "./replay.ts";
import { AF_CORE_KEY, AF_HOST_KEY } from "./core/host-contracts.ts";
import { previewOverride, resolveAppearance, withPreview } from "./core/appearance.ts";
import { AF_DESIGN_SYSTEM_ATTRIBUTE, AF_DESIGN_SYSTEM_PATH } from "../af-contracts.ts";

const NODE = "data-af-id";
const schedule = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
};
/** @param {{dark?: unknown, designSystem?: unknown} | null | undefined} value */
function viewerFrom(value) {
  return {
    designSystem: typeof value?.designSystem === "string" ? value.designSystem : null,
    dark: typeof value?.dark === "boolean" ? value.dark : null,
  };
}

function browserStorage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
/** @param {unknown} value */
const plainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function installBridge(boot) {
  /** @type {import("../apollo/apollo-contracts.ts").StatePort | null} */
  let local = null;
  let commenting = false,
    pending = false,
    historical = false,
    lastReport = null;
  const receiver = boot.local ? window : parent;
  const send = (data) =>
    receiver.postMessage({ pagegi: true, channel: boot.channel, ...data }, "*");
  const remote = createRemoteClient({
    send,
    id: () => crypto.randomUUID(),
    online: () => navigator.onLine,
    schedule,
  });
  let viewer = viewerFrom(boot.viewer);
  const viewerListeners = new Set();
  function setViewer(next) {
    viewer = viewerFrom(next);
    for (const listener of [...viewerListeners])
      try {
        listener({ ...viewer });
      } catch (error) {
        console.error(error);
      }
  }
  /** @type {import("./core/host-contracts.ts").CoreHost} */
  const host = {
    viewer: () => ({ ...viewer }),
    subscribeViewer(listener) {
      viewerListeners.add(listener);
      return () => viewerListeners.delete(listener);
    },
    // The viewer's own local state: seeded from the published page's state
    // block on first open, replaced by state loaded from the address
    // (#af-state), kept in this browser and never sent to other viewers.
    state(seed) {
      if (local) return local;
      if (typeof boot.page !== "string" || !boot.page) return null;
      local = persistentStore(
        plainObject(boot.seed) ? boot.seed : seed,
        viewerStateKey(boot.page),
        browserStorage(),
        {
          replace: plainObject(boot.load) ? boot.load : null,
          watch: (changed) => addEventListener("storage", changed),
        },
      );
      local.subscribe(report);
      return local;
    },
    remote: () => remote.port,
  };
  /** @type {import("./core/host-contracts.ts").LocalAttachment | null} */
  let attached = null;
  if (boot.local) {
    /** @type {import("./core/host-contracts.ts").CoreModules | undefined} */
    const core = globalThis[Symbol.for(AF_CORE_KEY)];
    if (typeof core?.attach !== "function")
      throw Error("Open this page from its Pagegi address");
    attached = core.attach({
      viewer: host.viewer,
      subscribeViewer: host.subscribeViewer,
      remote: host.remote,
    });
    local = attached.state;
    local.subscribe(report);
  } else
    Object.defineProperty(globalThis, Symbol.for(AF_HOST_KEY), {
      value: Object.freeze(host),
    });

  const offset = () =>
    boot.local ? document.getElementById("pg-bar")?.offsetHeight || 0 : 0;
  const isUI = (node) =>
    node instanceof Element && !!node.closest("[data-pagegi-ui]");
  let remoteSelections = [];
  let lastSelection;
  const selectionLayer = document.createElement("div");
  selectionLayer.dataset.pagegiUi = "";
  selectionLayer.setAttribute("aria-hidden", "true");
  Object.assign(selectionLayer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    userSelect: "none",
    webkitUserSelect: "none",
    zIndex: "2147483000",
  });

  function selectionChanged() {
    const selection = historical ? null : captureSelection(document);
    const key = JSON.stringify(selection);
    if (key === lastSelection) return;
    lastSelection = key;
    send({ kind: "selection", selection });
  }
  document.addEventListener("selectionchange", selectionChanged);
  function repaintSelections() {
    if (!selectionLayer.isConnected && document.body)
      document.body.append(selectionLayer);
    paintSelections(selectionLayer, historical ? [] : remoteSelections);
  }
  // The platform keeps its loading screen up until the page is styled: the
  // design system's stylesheet the core chose (the page's own arrives inline;
  // a viewer's other pick is fetched) has loaded or failed. The bridge runs
  // before the core, so the page's own inline CSS can settle before the core
  // has pointed the link at a viewer's other pick: only the system the core
  // will show counts. A stalled stylesheet stops holding the page after
  // STYLE_WAIT_MS.
  const DESIGN_SYSTEM_LINK = 'link[data-af="design-system"]';
  const STYLE_WAIT_MS = 5000;
  /** The page's own design system, read before the core resolves the viewer's. */
  const pageDesignSystem = document.documentElement.getAttribute(AF_DESIGN_SYSTEM_ATTRIBUTE);
  const preview = previewOverride(location.search);
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const resolveShown = (picks) =>
    resolveAppearance({
      pageDesignSystem,
      viewerDesignSystem: picks.designSystem,
      viewerDark: picks.dark,
      systemDark: scheme.matches,
    }).designSystem;
  /** The href of a design-system link whose fetch failed; a failed sheet stops holding the page. */
  let failedHref = null,
    styleWaitOver = !!boot.local;
  // A load event can arrive after the core has already pointed the link at
  // another href, so the event never says which sheet settled: the link's
  // own `sheet` does. The events only prompt a fresh report.
  function stylesheetSettled(event) {
    const target = event.target;
    if (target instanceof HTMLLinkElement && target.matches(DESIGN_SYSTEM_LINK)) {
      if (event.type === "error") failedHref = target.href;
      report();
    }
  }
  // An element's load event never reaches the window, so listen on the document.
  document.addEventListener("load", stylesheetSettled, true);
  document.addEventListener("error", stylesheetSettled, true);
  setTimeout(() => {
    styleWaitOver = true;
    report();
  }, STYLE_WAIT_MS);
  /** Whether `link` carries the CSS of `name`: fetched from the platform, or the page's own inline copy. */
  function carries(link, name) {
    if (link.href.startsWith("data:")) return name === resolveShown({ designSystem: null, dark: null });
    try {
      return new URL(link.href).pathname === `${AF_DESIGN_SYSTEM_PATH}${name}.css`;
    } catch {
      return false;
    }
  }
  function styled() {
    if (styleWaitOver) return true;
    const link = document.querySelector(DESIGN_SYSTEM_LINK);
    const shown = resolveShown(withPreview(viewer, preview));
    if (!(link instanceof HTMLLinkElement) || !link.href) return shown === null;
    if (!carries(link, shown)) return false;
    if (link.href === failedHref) return true;
    // An inline sheet has no network href to compare; any sheet on it is its own.
    const sheet = link.sheet;
    return !!sheet && (link.href.startsWith("data:") || sheet.href === link.href);
  }
  /** What a commenter saw: the page state, the scroll position and a rendered copy. */
  function capture() {
    const rendered = captureRenderedDocument(document);
    const snapshot = {
      schema: 0,
      sourceRevision: boot.revision,
      state: local ? local.read() : {},
      view: { x: scrollX, y: scrollY },
    };
    return rendered ? { ...snapshot, rendered } : snapshot;
  }
  function unique(el) {
    const id = el.getAttribute(NODE);
    return (
      [...document.querySelectorAll(`[${NODE}]`)].filter(
        (e) => e.getAttribute(NODE) === id,
      ).length === 1
    );
  }
  function anchor(node) {
    let el = node instanceof Element ? node.closest(`[${NODE}]`) : null;
    while (el && !unique(el)) el = el.parentElement?.closest(`[${NODE}]`);
    return el;
  }
  function targets() {
    return [...document.querySelectorAll(`[${NODE}]`)]
      .slice(0, 3000)
      .filter((el) => !isUI(el) && unique(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute(NODE),
          quote: (el.textContent || "").slice(0, 500),
          rect: { x: r.x, y: r.y - offset(), width: r.width, height: r.height },
        };
      });
  }
  function report() {
    if (pending) return;
    pending = true;
    // The shell keeps the frame hidden until the first view arrives, and
    // Firefox throttles animation frames in a hidden frame to about one a
    // second, so a short timer also flushes the report.
    const frame = requestAnimationFrame(flush);
    const timer = setTimeout(flush, 50);
    function flush() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (!pending) return;
      pending = false;
      repaintSelections();
      selectionChanged();
      const message = {
        kind: "view",
        snapshot: capture(),
        targets: targets(),
        styled: styled(),
      };
      const key = JSON.stringify(message);
      if (key === lastReport) return;
      lastReport = key;
      send(message);
    }
  }
  addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    remote.dispose();
    selectionLayer.remove();
    document.removeEventListener("selectionchange", selectionChanged);
  });
  addEventListener("message", (e) => {
    if (
      e.source !== receiver ||
      !e.data?.pagegi ||
      e.data.channel !== boot.channel
    )
      return;
    const m = e.data;
    if (m.kind === "selections") {
      remoteSelections = Array.isArray(m.viewers) ? m.viewers.slice(0, 50) : [];
      repaintSelections();
      return;
    }
    if (m.kind === "authorization-context") {
      remote.setAuthorizationContext(typeof m.context === "string" ? m.context : null);
      return;
    }
    if (m.kind === "remote-invalidated") {
      remote.invalidate();
      return;
    }
    if (m.kind === "remote-response") {
      remote.receive(m.response);
      return;
    }
    if (m.kind === "suspend") {
      historical = true;
      repaintSelections();
      selectionChanged();
      return;
    }
    if (m.kind === "restore") {
      historical = false;
      if (m.snapshot?.view) scrollTo(m.snapshot.view.x, m.snapshot.view.y);
      report();
      return;
    }
    if (m.kind === "appearance") {
      setViewer(m.viewer);
      return;
    }
    if (m.kind === "download") {
      attached?.save();
      return;
    }
    if (m.kind === "theme" && ["light", "dark"].includes(m.theme)) {
      setViewer({ ...viewer, dark: m.theme === "dark" });
      return;
    }
    if (m.kind === "mode") {
      commenting = m.on;
      document.documentElement.classList.toggle(
        "pagegi-commenting",
        commenting,
      );
    }
    if (m.kind === "scroll") {
      requestAnimationFrame(() => {
        scrollTo(m.view?.x || 0, m.view?.y || 0);
        report();
      });
    }
  });
  addEventListener(
    "click",
    (e) => {
      if (!commenting || isUI(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = anchor(e.target);
      send({
        kind: "pick",
        nodeId: el?.getAttribute(NODE) || null,
        quote: (el?.textContent || "").slice(0, 500),
        snapshot: capture(),
      });
    },
    true,
  );
  function context(e) {
    if (isUI(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = anchor(e.target),
      rect =
        e.target instanceof Element
          ? e.target.getBoundingClientRect()
          : { x: 0, y: 0 };
    send({
      kind: "context",
      nodeId: el?.getAttribute(NODE) || null,
      quote: (el?.textContent || "").slice(0, 500),
      snapshot: capture(),
      x: e.clientX || rect.x,
      y: (e.clientY || rect.y) - offset(),
    });
  }
  addEventListener("contextmenu", context, true);
  addEventListener(
    "keydown",
    (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
        context(e);
      if (e.key === "Escape") send({ kind: "dismiss" });
    },
    true,
  );
  addEventListener(
    "pointerdown",
    (e) => {
      if (!isUI(e.target)) send({ kind: "dismiss" });
    },
    true,
  );
  addEventListener(
    "pointermove",
    (e) => {
      if (isUI(e.target)) return;
      const el = anchor(e.target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      send({
        kind: "cursor",
        cursor: {
          nodeId: el.getAttribute(NODE),
          x: Math.max(0, Math.min(1, (e.clientX - r.x) / (r.width || 1))),
          y: Math.max(0, Math.min(1, (e.clientY - r.y) / (r.height || 1))),
        },
      });
    },
    { passive: true },
  );
  // Capture nested scrollers too; anchor paint and rail geometry use viewport coordinates.
  addEventListener("scroll", report, { passive: true, capture: true });
  addEventListener("load", report, true);
  const layoutObserver = new ResizeObserver(report);
  layoutObserver.observe(document.documentElement);
  if (document.body) layoutObserver.observe(document.body);
  else
    addEventListener(
      "DOMContentLoaded",
      () => document.body && layoutObserver.observe(document.body),
      { once: true },
    );
  addEventListener("resize", report);
  addEventListener("load", () => {
    if (boot.saved?.view) scrollTo(boot.saved.view.x, boot.saved.view.y);
    report();
  });
  addEventListener("error", (e) => send({ kind: "error", message: e.message }));
  new MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          r.target.isConnected &&
          !isUI(r.target) &&
          !(
            r.type === "childList" &&
            [...r.addedNodes, ...r.removedNodes].every(isUI)
          ),
      )
    )
      report();
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const style = document.createElement("style");
  style.textContent = `.pagegi-commenting [${NODE}]:hover{outline:2px solid #0e9d4f!important;outline-offset:3px;cursor:crosshair!important}html[data-af-dark=true].pagegi-commenting [${NODE}]:hover{outline-color:#3fe77b!important}`;
  style.dataset.pagegiUi = "";
  (document.head ?? document.documentElement).append(style);
  if (boot.saved?.view) scrollTo(boot.saved.view.x, boot.saved.view.y);
  report();
}
const bootElement = document.querySelector("#pagegi-boot");
if (bootElement) {
  const boot = JSON.parse(bootElement.textContent);
  bootElement.remove();
  installBridge(boot);
}
