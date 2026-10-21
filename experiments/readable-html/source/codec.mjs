import { parse, serialize } from "parse5";
import { validateCss } from "./css-policy.mjs";
const MAX = 2_000_000;
const fail = (message) => {
  throw new Error(message);
};
const attr = (n, k) => n.attrs?.find((a) => a.name === k)?.value;
const text = (n) => n.childNodes?.map((c) => c.value || "").join("") || "";
function setText(n, value) {
  n.childNodes = value ? [{ nodeName: "#text", value, parentNode: n }] : [];
}
function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || seen.has(value))
    fail("Invalid JSON value");
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) fail("Sparse JSON");
      jsonValue(value[i], seen);
    }
  } else {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      fail("JSON object required");
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail("JSON key required");
      jsonValue(value[key], seen);
    }
  }
  seen.delete(value);
}
function envelope(s) {
  jsonValue(s);
  if (
    !s ||
    s.format !== 2 ||
    !Object.hasOwn(s, "app") ||
    !Array.isArray(s.comments) ||
    Object.keys(s).sort().join(",") !== "app,comments,format"
  )
    fail("Invalid or privileged envelope fields");
  return s;
}
function tree(html) {
  if (
    typeof html !== "string" ||
    html.length > MAX ||
    html.includes("\0") ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      html,
    )
  )
    fail("Invalid source size or Unicode");
  const errors = [];
  const doc = parse(html, { onParseError: (e) => errors.push(e.code) });
  if (errors.length) fail("Malformed HTML: " + errors.join(","));
  /** @type {any} */ let runtime;
  /** @type {any} */ let metadata;
  const ids = new Set();
  function walk(n) {
    const tag = n.tagName;
    if (
      [
        "iframe",
        "object",
        "embed",
        "base",
        "noscript",
        "animate",
        "animateMotion",
        "animateTransform",
        "set",
        "discard",
      ].includes(tag)
    )
      fail("Unsupported active or parser-sensitive element");
    if (tag === "meta" && attr(n, "http-equiv") !== undefined)
      fail("HTTP metadata is platform-owned");
    for (const a of n.attrs || []) {
      if (
        [
          "fill",
          "stroke",
          "filter",
          "clip-path",
          "mask",
          "cursor",
          "marker",
          "marker-start",
          "marker-mid",
          "marker-end",
          "color-profile",
        ].includes(a.name)
      )
        validateCss(a.value, "value");
      if (a.name.startsWith("on")) fail("Unmanaged event handler");
      const url = a.value
        .replace(/[\t\n\r]/g, "")
        .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
      if (/^(?:javascript|vbscript):/i.test(url)) fail("Unmanaged script URL");
      if (["srcset", "imagesrcset", "ping"].includes(a.name))
        fail("Multi-URL dependencies are not in the portable profile");
      // parse5 stores namespaced attributes by local name (xlink:href -> href).
      const resource =
        ["src", "poster", "background"].includes(a.name) ||
        (a.name === "href" && !["a", "area"].includes(tag));
      if (resource && url && !url.startsWith("#") && !/^data:/i.test(url))
        fail("External dependency: embed or explicitly connect after mount");
    }
    if (tag === "link")
      fail("Embed styles; remote dependency unsupported in portable profile");
    if (tag === "style") validateCss(text(n), "stylesheet");
    for (const a of n.attrs || [])
      if (a.name === "style") validateCss(a.value, "declarationList");
    const id = attr(n, "data-pagegi-id");
    if (id !== undefined) {
      if (!id || ids.has(id)) fail("Duplicate or empty stable identity");
      ids.add(id);
    }
    if (attr(n, "id") === "pagegi-state") {
      if (
        metadata ||
        tag !== "script" ||
        attr(n, "type") !== "application/json" ||
        n.parentNode?.tagName !== "head"
      )
        fail("Ambiguous state metadata");
      metadata = n;
    }
    if (attr(n, "data-pagegi-runtime") !== undefined) {
      if (
        runtime ||
        tag !== "script" ||
        attr(n, "data-pagegi-runtime") !== "2" ||
        n.attrs.length !== 1 ||
        n.parentNode?.tagName !== "head"
      )
        fail("Invalid runtime");
      runtime = n;
    }
    if (tag === "script") {
      if (attr(n, "src") !== undefined) fail("External script dependency");
      if (
        attr(n, "data-pagegi-runtime") === undefined &&
        attr(n, "type") !== "application/json" &&
        attr(n, "type") !== "application/pagegi"
      )
        fail("Unmanaged executable script");
    }
    for (const c of n.childNodes || []) walk(c);
    if (n.content) walk(n.content);
  }
  walk(doc);
  if (!runtime || !metadata) fail("Missing managed runtime or state");
  const head = runtime.parentNode;
  if (head.childNodes.indexOf(runtime) >= head.childNodes.indexOf(metadata))
    fail("Runtime must precede metadata");
  return { doc, runtime, metadata };
}
/** @param {string} html @param {{runtime?: string}} [options] @returns {Promise<import("./contracts.ts").DecodedDocument>} */
export async function decode(html, options = {}) {
  const { doc, runtime, metadata } = tree(html);
  const state = envelope(JSON.parse(text(metadata)));
  if (text(runtime).trim() && text(runtime) !== options.runtime)
    fail("Unrecognized runtime bytes; reinstall pinned runtime");
  setText(runtime, "");
  setText(metadata, "");
  const source = serialize(doc);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("pagegi-readable-v2/parse5-7.3.0\n" + source),
  );
  return {
    source,
    state,
    revision: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
/** @param {string} source @param {import("./contracts.ts").Envelope} state @returns {string} */
export function save(source, state) {
  envelope(state);
  const { doc, runtime, metadata } = tree(source);
  setText(runtime, "");
  setText(metadata, JSON.stringify(state).replaceAll("<", "\\u003c"));
  const result = serialize(doc);
  if (result.length > MAX) fail("Export exceeds size limit");
  return result;
}
