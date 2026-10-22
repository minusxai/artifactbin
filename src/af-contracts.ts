/**
 * Shared Pagegi v2 vocabulary. Frozen in phase 0: every phase-1 brief imports
 * these names and none of them edits this file. The author contract is the
 * skill in skills/pagegi-author/.
 */

/** Plain data the platform stores and sends: no undefined, NaN, Infinity, functions or class instances. */
export type AfJson =
  | null
  | boolean
  | number
  | string
  | AfJson[]
  | { [key: string]: AfJson };
export type AfJsonObject = { [key: string]: AfJson };

/** One file ID: six characters from [A-Za-z0-9]. It is both the API handle and the address. */
export type FileId = string;
export const FILE_ID_PATTERN = /^[A-Za-z0-9]{6}$/;
export const FILE_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** UTF-8 byte budget for submitted and normalized saved HTML, including metadata. */
export const MAX_PAGE_SOURCE = 6_000_000;
/** Independent unchanged aggregate backend source quota, measured in UTF-16 characters. */
export const MAX_BACKEND_SOURCE_CHARACTERS = 4_000_000;
/** Independent HTTP JSON envelope budget. Escaping/other fields count as bytes too. */
export const MAX_REQUEST_BODY_BYTES = 8_000_000;
/** Same UTF-8 replacement semantics in Node and browsers, including lone surrogates. */
export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

/** The default public host the skill writes. Servers rewrite this prefix to their own origin on save. */
export const DEFAULT_AF_ORIGIN = "https://app.artefactbin.dev";
/** Hosts the skill used to write. Every server keeps rewriting them, so pages published with them keep working. */
export const LEGACY_AF_ORIGINS: readonly string[] = ["https://artifactbin.dev", "https://pagegi.artifactbin.dev"];
/** Every origin a server rewrites to its own on save, besides the ones it is configured with. */
export const KNOWN_AF_ORIGINS: readonly string[] = [DEFAULT_AF_ORIGIN, ...LEGACY_AF_ORIGINS];
/** Every platform-served path lives under this prefix. */
export const AF_PATH_PREFIX = "/af/v1/";
/** `${origin}/af/v1/core.js` */
export const AF_CORE_PATH = "/af/v1/core.js";
/** `${origin}/af/v1/design-systems/<name>.css` */
export const AF_DESIGN_SYSTEM_PATH = "/af/v1/design-systems/";
/** `${origin}/af/v1/ids/<id>`: any file by ID (a backend file's only address). */
export const AF_IDS_PATH = "/af/v1/ids/";
/** `${origin}/a/<id>`: a page's canonical address; `-<anything>` after the ID is ignored. */
export const AF_PAGE_PATH = "/a/";
/** `${origin}/@<handle>/<path>`: a page by its owner's handle and library path. */
export const AF_USER_PATH_PREFIX = "/@";
/** `${origin}/skills/pagegi-author.tgz`: the whole author skill as one gzip tarball. */
export const SKILL_ARCHIVE_PATH = "/skills/pagegi-author.tgz";
/** `curl -fsSL <origin>/install.sh | sh` installs the skill for every coding agent on the machine. */
export const INSTALL_SCRIPT_PATH = "/install.sh";

/** Marker attributes. `data-af-id` is only ever a node ID. */
export const AF_MARKER = "data-af";
/** `<script type="application/json" data-af="meta">` in <head>. */
export const AF_META_MARKER = "meta";
/** `<link rel="stylesheet" data-af="design-system">`, added by the core, never by authors. */
export const AF_DESIGN_SYSTEM_MARKER = "design-system";
/** `<script data-af="core">…</script>`: the core inlined into a downloaded file. */
export const AF_INLINE_CORE_MARKER = "core";
/**
 * On the inline core of a downloaded file: the origin of the server the file
 * came from (`data-af-server`) and that server's digest of the page version in
 * the file (`data-af-revision`). With `id` and `version` in the meta block they
 * are the page's identity; the file carries no credential. The save turns the
 * inline core back into the src form, which drops both.
 */
export const AF_SERVER_ATTRIBUTE = "data-af-server";
export const AF_REVISION_ATTRIBUTE = "data-af-revision";
/** `<script type="application/json" data-af="state">`: page state carried by a downloaded file. */
export const AF_STATE_MARKER = "state";
export const AF_NODE_ID_ATTRIBUTE = "data-af-id";
export const AF_BACKEND_REL = "af-backend";
export const AF_BACKEND_NAME_ATTRIBUTE = "data-af-name";
/** Platform-assigned node IDs are this prefix plus a decimal counter: n1, n2, … */
export const AF_NODE_ID_PREFIX = "n";

/** File states the core sets on <html>. */
export const AF_DARK_ATTRIBUTE = "data-af-dark";
export const AF_DESIGN_SYSTEM_ATTRIBUTE = "data-af-design-system";
export const DESIGN_SYSTEMS = [
  "volta",
  "phosphor",
  "drafting",
  "meridian",
  "dossier",
  "riso",
  "almanac",
  "redline",
  "nocturne",
  "broadsheet",
  "signout",
  "sorbet",
  "arcade",
] as const;
export type DesignSystemName = (typeof DESIGN_SYSTEMS)[number];
/** Used when neither the page nor the viewer picked one. */
export const DEFAULT_DESIGN_SYSTEM: DesignSystemName = "meridian";

/** How a remote (backend) mutation field settled. Local writes never use `offline`. */
export type Outcome = "committed" | "rejected" | "offline" | "unknown";

/** Page role of a caller; `@auth(role: …)` compares against this order: VIEWER < EDITOR < OWNER. */
export type PageRole = "VIEWER" | "EDITOR" | "OWNER";

/** Environment variables a harness may set to give an agent a server and token. */
export const AF_SERVER_ENV = "AF_SERVER";
export const AF_TOKEN_ENV = "AF_TOKEN";
