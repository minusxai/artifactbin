/**
 * Local state kept in this viewer's browser. A hosted page keeps one copy per
 * page (viewerStateKey); a page opened on its own, such as a downloaded file,
 * keys its copy by the page and the state it was saved with (standaloneKey).
 * A downloaded file also offers one control that saves the page again with
 * its current state.
 */
import { AF_MARKER, AF_META_MARKER, AF_STATE_MARKER } from "../../af-contracts.ts";
import type { AfJson, AfJsonObject } from "../../af-contracts.ts";
import type { StatePort } from "../../apollo/apollo-contracts.ts";
import { assertStorable } from "../../apollo/storable.ts";

/** Prefix of the browser-storage key a page keeps the viewer's local state under. */
export const AF_STANDALONE_STATE_PREFIX = "af:state:";

/** Short stable digest (FNV-1a) of text, for storage keys. */
export function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The storage key of a page opened on its own: the page's ID (or its address
 * when it has none) and the state block it was saved with, so a newer
 * download of the same page starts from its own state instead of an older copy's.
 */
export function standaloneKey(pageId: string, seedText: string): string {
  return `${AF_STANDALONE_STATE_PREFIX}${pageId}:${digest(seedText)}`;
}

/** The storage key of a hosted page: one copy per page for this viewer, whatever version is open. */
export function viewerStateKey(pageId: string): string {
  return `${AF_STANDALONE_STATE_PREFIX}${pageId}`;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStored(storage: KeyValueStorage | null, key: string): AfJsonObject | null {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    assertStorable(value);
    return value as AfJsonObject;
  } catch {
    return null;
  }
}

function canonical(value: AfJson | undefined): string {
  if (value === undefined) return "u";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const own = (document: AfJsonObject, key: string): AfJson | undefined =>
  Object.hasOwn(document, key) ? document[key] : undefined;

export interface PersistentStoreOptions {
  /** Start from this state instead of the stored copy, and save it (state loaded from a URL). */
  replace?: AfJsonObject | null;
  /** Called once with a callback to run when another tab may have saved (the `storage` event). */
  watch?: (changed: () => void) => void;
}

/**
 * A compare-and-swap store over browser storage: it starts from the stored
 * copy (else `seed`), every write checks against the latest stored copy (so
 * two tabs of one viewer never overwrite each other), and a change saved by
 * another tab reaches this tab's listeners. Without working storage it keeps
 * state in memory.
 */
export function persistentStore(
  seed: AfJsonObject,
  key: string,
  storage: KeyValueStorage | null,
  options: PersistentStoreOptions = {},
): StatePort {
  assertStorable(seed);
  let document: AfJsonObject = copy(options.replace ?? readStored(storage, key) ?? seed);
  const listeners = new Set<(document: AfJsonObject) => void>();
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(document));
    } catch {
      // Storage full or blocked: from here on the page keeps its state in memory,
      // so a committed change is never undone by the stale stored copy.
      storage = null;
    }
  };
  const notify = () => {
    for (const listener of [...listeners])
      try {
        listener(copy(document));
      } catch {
        /* One view cannot stop another from updating. */
      }
  };
  /** Adopt another tab's saved copy; true when it differed. */
  const refresh = () => {
    const stored = readStored(storage, key);
    if (!stored || canonical(stored) === canonical(document)) return false;
    document = stored;
    return true;
  };
  if (options.replace) save();
  options.watch?.(() => {
    if (refresh()) notify();
  });
  return {
    read() {
      if (refresh()) notify();
      return copy(document);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async write(change) {
      const changedElsewhere = refresh();
      const mismatch =
        Object.entries(change.expected).some(([name, value]) => canonical(own(document, name)) !== canonical(value)) ||
        (change.exact && Object.keys(document).some((name) => !Object.hasOwn(change.expected, name)));
      if (mismatch) {
        if (changedElsewhere) notify();
        return { status: "conflict", document: copy(document) };
      }
      try {
        for (const value of Object.values(change.next)) if (value !== undefined) assertStorable(value);
      } catch (error) {
        return {
          status: "rejected",
          document: copy(document),
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const updated: AfJsonObject = { ...document };
      for (const [name, value] of Object.entries(change.next)) {
        if (value === undefined) delete updated[name];
        else updated[name] = copy(value);
      }
      if (change.requireDurable) {
        if (!storage) return {status:"rejected",document:copy(document),error:"Durability unavailable"};
        try { storage.setItem(key, JSON.stringify(updated)); }
        catch { return {status:"rejected",document:copy(document),error:"Durability unavailable"}; }
        document = updated;
        notify();
        return {status:"committed",document:copy(document),durable:true};
      }
      document = updated;
      save();
      notify();
      return { status: "committed", document: copy(document) };
    },
  };
}

/** The page file `html` with its `data-af="state"` block holding `state` (added before </head> if missing). */
export function withState(html: string, state: AfJsonObject): string {
  const block = `<script type="application/json" ${AF_MARKER}="${AF_STATE_MARKER}">${scriptJson(state)}</script>`;
  const existing = /<script\b[^>]*\bdata-af=["']?state["']?[^>]*>[\s\S]*?<\/script\s*>/i;
  if (existing.test(html)) return html.replace(existing, () => block);
  return /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, (end) => block + end) : block + html;
}

/** The page's ID from its metadata block, or null. */
export function metaId(document: Document): string | null {
  const block = document.querySelector(`script[type="application/json"][${AF_MARKER}="${AF_META_MARKER}"]`);
  try {
    const id = JSON.parse(block?.textContent || "null")?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** Text of a JSON value safe inside <script>. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The page as a file again: `root` is a copy of <html> taken before the page's
 * own scripts ran, with the core's additions already removed; its state block
 * is replaced by `state`.
 */
export function savedPage(root: Element, state: AfJsonObject, doctype = "<!DOCTYPE html>"): string {
  const copy = root.cloneNode(true) as Element;
  const document = copy.ownerDocument;
  let block = copy.querySelector(`script[type="application/json"][${AF_MARKER}="${AF_STATE_MARKER}"]`);
  if (!block) {
    block = document.createElement("script");
    block.setAttribute("type", "application/json");
    block.setAttribute(AF_MARKER, AF_STATE_MARKER);
    (copy.querySelector("head") ?? copy).append(block);
  }
  block.textContent = scriptJson(state);
  return `${doctype}\n${copy.outerHTML}\n`;
}

/** A file name for the page: its metadata name or title, else "page". */
export function fileName(name: string | null | undefined): string {
  const base = (name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80);
  return (base || "page").replace(/\.html?$/i, "") + ".html";
}

/**
 * The one control a downloaded file shows: save the page with its current
 * state. Lives in a shadow root so the page's styles don't reach it, and
 * carries no data-af-id.
 */
export function installDownloadControl(document: Document, save: () => void): HTMLElement {
  const host = document.createElement("af-download");
  host.setAttribute("aria-label", "Artifactbin");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483000}
button{font:500 13px/1 system-ui,sans-serif;padding:8px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.2);background:#fff;color:#1a2129;box-shadow:0 1px 4px rgba(0,0,0,.15);cursor:pointer}
button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
@media (prefers-color-scheme:dark){button{background:#1a2129;color:#e6edf3;border-color:rgba(255,255,255,.2)}}
@media print{:host{display:none}}`;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Download page";
  button.title = "Save this page with its current state as an HTML file";
  button.addEventListener("click", save);
  shadow.append(style, button);
  document.body.append(host);
  return host;
}
