/**
 * The core script, /af/v1/core.js. Loaded first in <head> as a classic
 * script; see core-contracts.ts for the order of what it does. It runs in the
 * page's own realm and never holds a token: in a hosted page the runner bridge
 * (registered under Symbol.for(AF_HOST_KEY)) carries state and backend calls
 * to the platform frame by postMessage.
 */
import {
  AF_BACKEND_NAME_ATTRIBUTE,
  AF_BACKEND_REL,
  AF_DARK_ATTRIBUTE, AF_DESIGN_SYSTEM_ATTRIBUTE, AF_INLINE_CORE_MARKER, AF_META_MARKER,
  AF_DESIGN_SYSTEM_MARKER,
  AF_MARKER,
  AF_REVISION_ATTRIBUTE,
  AF_SERVER_ATTRIBUTE,
  AF_STATE_MARKER,
  DEFAULT_AF_ORIGIN,
} from "../../af-contracts.ts";
import type { AfJsonObject } from "../../af-contracts.ts";
import { AF_STATE_FRAGMENT, RemoteUnreachable } from "../../apollo/apollo-contracts.ts";
import type { AfClient, RemotePort, StatePort } from "../../apollo/apollo-contracts.ts";
import { createClient, createLocalStore, gql, readStateFragment } from "../../apollo/client.ts";
import { designSystemHref, htmlAttributes, importMap, previewOverride, resolveAppearance, withPreview } from "./appearance.ts";
import { AF_CORE_KEY, AF_HOST_KEY, AF_VIEWER_STORAGE_KEY } from "./host-contracts.ts";
import type { CoreHost, CoreModules, LocalAttachment, ViewerAppearance } from "./host-contracts.ts";
import { fileName, installDownloadControl, metaId, persistentStore, savedPage, standaloneKey, type KeyValueStorage } from "./standalone.ts";

type Registry = Record<symbol, unknown>;
const registry = globalThis as unknown as Registry;

/** The `@afbin/apollo` module: a blob so it resolves the same in a downloaded file. */
const APOLLO_MODULE = `const core = globalThis[Symbol.for(${JSON.stringify(AF_CORE_KEY)})];
export const gql = core.gql;
export const client = core.client();
`;

function readViewer(): ViewerAppearance {
  try {
    const stored = JSON.parse(localStorage.getItem(AF_VIEWER_STORAGE_KEY) || "null");
    return {
      designSystem: typeof stored?.designSystem === "string" ? stored.designSystem : null,
      dark: typeof stored?.dark === "boolean" ? stored.dark : null,
    };
  } catch {
    return { designSystem: null, dark: null };
  }
}

/** A page opened on its own: picks remembered in this browser, never in the page. */
function standaloneHost(): Pick<CoreHost, "viewer" | "subscribeViewer"> {
  return {
    viewer: readViewer,
    subscribeViewer(listener) {
      const changed = (event: StorageEvent) => {
        if (event.key === AF_VIEWER_STORAGE_KEY) listener(readViewer());
      };
      addEventListener("storage", changed);
      return () => removeEventListener("storage", changed);
    },
  };
}

/** No platform frame, so nothing can be sent: every backend call settles offline. */
const unconnectedRemote: RemotePort = {
  online: () => false,
  execute: () => Promise.reject(new RemoteUnreachable("This page is not connected to a Pagegi server")),
};

function readSeed(): { seed: AfJsonObject; text: string } {
  const block = document.querySelector(`script[type="application/json"][${AF_MARKER}="${AF_STATE_MARKER}"]`);
  const text = block?.textContent || "";
  if (!block) return { seed: {}, text };
  try {
    const value = JSON.parse(text || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return { seed: value, text };
  } catch (error) {
    console.warn("Pagegi: ignoring an unreadable data-af=\"state\" block", error);
  }
  return { seed: {}, text };
}

function browserStorage(): KeyValueStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Reads `#af-state=` from this page's address, removes it, and returns the state (null if absent or unusable). */
function takeStateFragment(): AfJsonObject | null {
  const fragment = readStateFragment(location.hash);
  if (!fragment.found) return null;
  try {
    history.replaceState(history.state, "", location.href.split("#")[0] + fragment.rest);
  } catch {}
  if (fragment.error) console.warn(`Pagegi: ignoring #${AF_STATE_FRAGMENT}: ${fragment.error}`);
  return fragment.state;
}

/** `data-af-server` on the inline core: an http(s) origin, or null. */
function serverOrigin(script: HTMLScriptElement | null): string | null {
  try {
    const url = new URL(script?.getAttribute(AF_SERVER_ATTRIBUTE) || "");
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function backendNames(): string[] {
  return [...document.querySelectorAll(`link[rel~="${AF_BACKEND_REL}"][${AF_BACKEND_NAME_ATTRIBUTE}]`)]
    .map((link) => link.getAttribute(AF_BACKEND_NAME_ATTRIBUTE) || "")
    .filter((name, index, all) => name && all.indexOf(name) === index);
}

function start(): void {
  if (registry[Symbol.for(AF_CORE_KEY)]) return; // loaded twice: the first core owns the page
  const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
  const src = script?.src || "";
  const platformOrigin = src ? new URL(src).origin : null;
  const root = document.documentElement;
  const head = document.head ?? root;
  const host = registry[Symbol.for(AF_HOST_KEY)] as CoreHost | undefined;
  // A downloaded file carries the core inline; it alone gets the download control
  // and, when it names its server, that server's platform runtime.
  const downloaded = !host && script?.getAttribute(AF_MARKER) === AF_INLINE_CORE_MARKER;
  const server = downloaded ? serverOrigin(script) : null;
  const revision = downloaded ? script?.getAttribute(AF_REVISION_ATTRIBUTE) || null : null;
  // Where the viewer's picks and backend calls come from; a runtime attached later replaces both.
  let viewer: Pick<CoreHost, "viewer" | "subscribeViewer"> = host ?? standaloneHost();
  let remote: RemotePort = host ? host.remote() : unconnectedRemote;
  const switchableRemote: RemotePort = {
    online: () => remote.online(),
    execute: (request) => remote.execute(request),
  };
  let attached = false;
  let control: HTMLElement | null = null;
  const originalAttributes = [AF_DARK_ATTRIBUTE, AF_DESIGN_SYSTEM_ATTRIBUTE].map(
    (name) => [name, root.getAttribute(name)] as const,
  );

  // 1. The import map, before anything can load a module.
  let client: AfClient | undefined;
  let store: StatePort | undefined;
  // `#af-state=` on a page opened on its own (a hosted page's shell reads its own address).
  const loaded = host ? null : takeStateFragment();
  // `#af-state=` pasted into an open page: load it the same way as on open.
  if (!host)
    addEventListener("hashchange", () => {
      if (readStateFragment(location.hash).found) location.reload();
    });
  /** The viewer's local state, once the page is parsed. */
  function state(): StatePort {
    if (store) return store;
    const { seed, text } = readSeed();
    // Opened on its own, state stays in this browser across reloads.
    const page = metaId(document) ?? location.pathname;
    store = host
      ? (host.state(seed) ?? createLocalStore(seed))
      : persistentStore(seed, standaloneKey(page, text), browserStorage(), {
          replace: loaded,
          watch: (changed) => addEventListener("storage", changed),
        });
    return store;
  }
  const modules: CoreModules = {
    gql,
    client() {
      if (client) return client;
      const backends = backendNames();
      client = createClient({
        backends,
        state: state(),
        ...(backends.length ? { remote: switchableRemote } : {}),
      });
      return client;
    },
    ...(server
      ? {
          attach(late): LocalAttachment {
            if (attached) throw Error("A platform runtime is already attached to this page");
            attached = true;
            viewer = late;
            late.subscribeViewer(apply);
            apply();
            remote = late.remote();
            control?.remove();
            control = null;
            return { state: state(), save, server, revision };
          },
        }
      : {}),
  };
  Object.defineProperty(globalThis, Symbol.for(AF_CORE_KEY), { value: Object.freeze(modules) });
  const apollo = URL.createObjectURL(new Blob([APOLLO_MODULE], { type: "text/javascript" }));
  const map = document.createElement("script");
  map.type = "importmap";
  map.textContent = JSON.stringify(importMap({ apollo }));
  if (script?.parentNode) script.before(map);
  else head.prepend(map);

  // 2. File states on <html>; 3. the design-system link right after the core.
  const pageDesignSystem = root.getAttribute(AF_DESIGN_SYSTEM_ATTRIBUTE);
  const system = matchMedia("(prefers-color-scheme: dark)");
  // `?af-dark=1&af-design-system=dossier` forces an appearance (screenshots, previews).
  const preview = previewOverride(location.search);
  // A hosted page arrives with the page's own system's CSS inline, in a link before the
  // core (what follows the core is not parsed yet): keep it, and fetch nothing for it.
  let link: HTMLLinkElement | null = platformOrigin
    ? document.querySelector<HTMLLinkElement>(`link[${AF_MARKER}="${AF_DESIGN_SYSTEM_MARKER}"]`)
    : null;
  /** The system whose CSS the link holds; "" until the core sets one. */
  let shown = link
    ? resolveAppearance({ pageDesignSystem, viewerDesignSystem: null, viewerDark: null, systemDark: false }).designSystem
    : "";
  if (platformOrigin && !link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    // A script-inserted stylesheet does not block rendering by itself: without this the
    // page paints once unstyled before the design system arrives.
    link.setAttribute("blocking", "render");
    link.setAttribute(AF_MARKER, AF_DESIGN_SYSTEM_MARKER);
    if (script?.parentNode) script.after(link);
    else head.append(link);
  }
  function apply(): void {
    const picks = withPreview(viewer.viewer(), preview);
    const appearance = resolveAppearance({
      pageDesignSystem,
      viewerDesignSystem: picks.designSystem,
      viewerDark: picks.dark,
      systemDark: system.matches,
    });
    for (const [name, value] of Object.entries(htmlAttributes(appearance)))
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    // An inline core (a downloaded file) carries its own link with the CSS inside; keep it until the viewer switches.
    if (shown && shown !== appearance.designSystem)
      link ??= document.querySelector<HTMLLinkElement>(`link[${AF_MARKER}="${AF_DESIGN_SYSTEM_MARKER}"]`);
    if (link && (platformOrigin || shown) && shown !== appearance.designSystem)
      link.href = designSystemHref(platformOrigin ?? server ?? DEFAULT_AF_ORIGIN, appearance.designSystem);
    shown = appearance.designSystem;
  }
  apply();
  system.addEventListener("change", apply);
  viewer.subscribeViewer(apply);

  // 4. A downloaded file: keep a copy of the page as parsed (before its own
  // deferred and module scripts run, without the core's additions) to save
  // again with the current state, and offer that as one control. When the
  // file names its server, that server's platform runtime (the bar, comments,
  // presence, Connect) is loaded too; offline it simply fails to arrive.
  if (!downloaded) return;
  let runtime: HTMLScriptElement | null = null;
  if (server) {
    runtime = document.createElement("script");
    runtime.src = server + "/runtime.js";
    runtime.async = true;
    if (script?.parentNode) script.after(runtime);
    else head.append(runtime);
  }
  let parsed: Element | null = null;
  const added = [map, ...(link ? [link] : []), ...(runtime ? [runtime] : [])];
  function capture(): void {
    if (parsed || document.readyState === "loading") return;
    for (const node of added) node.setAttribute("data-af-transient", "");
    parsed = root.cloneNode(true) as Element;
    for (const node of added) node.removeAttribute("data-af-transient");
    parsed.querySelectorAll("[data-af-transient],[data-pagegi-ui]").forEach((node) => node.remove());
    for (const [name, value] of originalAttributes)
      if (value === null) parsed.removeAttribute(name);
      else parsed.setAttribute(name, value);
  }
  document.addEventListener("readystatechange", capture);
  function save(): void {
    capture();
    const meta = document.querySelector(`script[type="application/json"][${AF_MARKER}="${AF_META_MARKER}"]`);
    let name: string | null = null;
    try {
      name = JSON.parse(meta?.textContent || "null")?.name ?? null;
    } catch {}
    const html = savedPage(parsed!, state().read());
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName(typeof name === "string" ? name : document.title);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  const show = () => {
    if (!attached) control = installDownloadControl(document, save);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show, { once: true });
  else show();
}

start();
