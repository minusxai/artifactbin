// @ts-check
/** The document this platform runtime runs for: in the hosted shell, the
 * page's source and saved collaboration state read from the server before any
 * page script runs; in a downloaded file (no `#pagegi-host`), the file itself,
 * identified by its meta block and the server and revision on its core tag. */
import { readStateFragment } from "../apollo/state-url.ts";
import { AF_STATE_FRAGMENT } from "../apollo/apollo-contracts.ts";
import {
  AF_INLINE_CORE_MARKER,
  AF_MARKER,
  AF_META_MARKER,
  AF_REVISION_ATTRIBUTE,
  AF_SERVER_ATTRIBUTE,
  FILE_ID_PATTERN,
} from "../af-contracts.ts";
/** @param {unknown} value @returns {value is import("../af-contracts.ts").AfJsonObject} */
const plainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
/**
 * `#af-state=` on the page's address: the state to load for this viewer. It
 * is removed from the address bar, so a reload keeps the viewer's own copy.
 * @returns {import("../af-contracts.ts").AfJsonObject | null}
 */
function takeStateFragment() {
  const fragment = readStateFragment(location.hash);
  if (!fragment.found) return null;
  try {
    history.replaceState(
      history.state,
      "",
      location.href.split("#")[0] + fragment.rest,
    );
  } catch {}
  if (fragment.error)
    console.warn(`Pagegi: ignoring #${AF_STATE_FRAGMENT}: ${fragment.error}`);
  return fragment.state;
}
/**
 * The design system the server sent with the page: a name and the `data:` URL
 * of its CSS, nothing else is ever used as a stylesheet address.
 * @param {unknown} value @returns {import("./lifecycle-contracts.ts").HostedDesignSystem | null}
 */
function hostedDesignSystem(value) {
  if (!plainObject(value)) return null;
  const { name, href } = /** @type {{name?: unknown, href?: unknown}} */ (value);
  return typeof name === "string" && typeof href === "string" && href.startsWith("data:text/css;base64,")
    ? { name, href }
    : null;
}
/** Same revision digest the server computes for a source. */
const REVISION_PREFIX = "pagegi-readable-v2/parse5-7.3.0\n";
/** @returns {Promise<import("./lifecycle-contracts.ts").PortableDocumentSession>} */
export async function openDocument() {
  if (document.readyState === "loading")
    await new Promise((resolve) =>
      document.addEventListener("DOMContentLoaded", resolve, { once: true }),
    );
  const tag = document.querySelector("#pagegi-host");
  if (!tag) return openLocalDocument();
  const shell = JSON.parse(tag.textContent || "null");
  const response = await fetch(shell.stateUrl, { credentials: "same-origin" });
  if (!response.ok) throw Error("Document access denied");
  const data = await response.json();
  const source = data.source;
  if (typeof source !== "string") throw Error("Document source unavailable");
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(REVISION_PREFIX + source),
  );
  const revision = [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const state = structuredClone(data.state);
  if (state.sourceRevision !== revision) {
    // The source changed since this state was saved: its view snapshot no longer applies.
    state.sourceRevision = revision;
    state.app = null;
    state.anchors = {};
  }
  return {
    source,
    state,
    seed: plainObject(data.seed) ? data.seed : null,
    load: takeStateFragment(),
    shell,
    hosted: data.boot || null,
    preview: data.preview || null,
    designSystem: hostedDesignSystem(data.designSystem),
    local: false,
  };
}

/**
 * A downloaded file: the page is this document. Its identity comes from
 * `data-af="meta"` (id, version) and the core tag (server, revision); the
 * server's state arrives later through the platform frame.
 * @returns {import("./lifecycle-contracts.ts").PortableDocumentSession}
 */
function openLocalDocument() {
  const core = document.querySelector(
    `script[${AF_MARKER}="${AF_INLINE_CORE_MARKER}"]`,
  );
  let server = "";
  try {
    const url = new URL(core?.getAttribute(AF_SERVER_ATTRIBUTE) || "");
    if (url.protocol === "http:" || url.protocol === "https:")
      server = url.origin;
  } catch {}
  /** @type {{id?: unknown, version?: unknown} | null} */
  let meta = null;
  try {
    meta = JSON.parse(
      document.querySelector(
        `script[type="application/json"][${AF_MARKER}="${AF_META_MARKER}"]`,
      )?.textContent || "null",
    );
  } catch {}
  const id = typeof meta?.id === "string" && FILE_ID_PATTERN.test(meta.id) ? meta.id : "";
  const version =
    typeof meta?.version === "number" && Number.isSafeInteger(meta.version) && meta.version >= 1
      ? meta.version
      : 0;
  if (!core || !server || !id || !version)
    throw Error("Open this page from its Artifactbin address");
  const revision = core.getAttribute(AF_REVISION_ATTRIBUTE) || String(version);
  return {
    source: document.documentElement.outerHTML,
    state: {
      format: 1,
      fileId: id,
      sourceRevision: revision,
      // The file holds no capability; the frame takes the link's from the page it opens.
      remote: { origin: server, share: "", head: revision },
      anchors: {},
      comments: [],
      pending: [],
      app: null,
      snapshots: {},
      sources: {},
      profiles: {},
      publishRequest: "",
    },
    seed: null,
    load: null,
    shell: null,
    hosted: null,
    preview: null,
    // The file already carries its design system's CSS in its own link.
    designSystem: null,
    local: true,
    page: { server, id, version, revision },
  };
}
