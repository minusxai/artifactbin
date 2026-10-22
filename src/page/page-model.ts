/**
 * The page source model (contract: ./page-contracts.ts). The server runs it on
 * publish and save; the skill's scripts/check.mjs bundles the same code.
 */
import {
  AF_BACKEND_NAME_ATTRIBUTE,
  AF_CORE_PATH,
  DEFAULT_AF_ORIGIN,
  AF_DARK_ATTRIBUTE,
  AF_DESIGN_SYSTEM_ATTRIBUTE,
  AF_DESIGN_SYSTEM_MARKER,
  AF_IDS_PATH,
  AF_INLINE_CORE_MARKER,
  AF_META_MARKER,
  AF_NODE_ID_ATTRIBUTE,
  AF_NODE_ID_PREFIX,
  AF_PATH_PREFIX,
  AF_REVISION_ATTRIBUTE,
  AF_SERVER_ATTRIBUTE,
  AF_STATE_MARKER,
  DESIGN_SYSTEMS,
  FILE_ID_PATTERN,
} from "../af-contracts.ts";
import type { AfJson, AfJsonObject, DesignSystemName, FileId } from "../af-contracts.ts";
import { KNOWN_CDN_HOSTS, PageError } from "./page-contracts.ts";
import type {
  AssignOptions,
  AssignResult,
  BackendLink,
  CoreTag,
  NodeIdChange,
  PageMeta,
  PageProblem,
  PageProblemCode,
  ParsedPage,
  PortableAssets,
  PreparedPage,
  SaveContext,
} from "./page-contracts.ts";
import {
  afterElement,
  applyEdits,
  atHeadStart,
  attribute,
  attributeValueStart,
  escapeAttribute,
  hasAncestor,
  insertAttribute,
  lineIndent,
  parseSource,
  rawContent,
  relTokens,
  removeAttribute,
  removeElement,
  setAttribute,
  setHtmlAttribute,
  startLine,
  written,
} from "./html-source.ts";
import type { Edit, Element, SourceDocument } from "./html-source.ts";
import { scriptJson, setMembers } from "./json-members.ts";
import {
  URL_BASE,
  isBackendLink,
  isCore,
  isDesignSystemLink,
  isExternalCore,
  isMetaBlock,
  isScript,
  isStateBlock,
  platformUrl,
} from "./markers.ts";

// ---------------------------------------------------------------------------
// Recognition

const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SKIPPED_TAGS = new Set(["script", "style", "template"]);

function backendId(href: string | null): FileId | null {
  const url = platformUrl(href);
  if (!url || !url.pathname.startsWith(AF_IDS_PATH)) return null;
  const id = url.pathname.slice(AF_IDS_PATH.length);
  return FILE_ID_PATTERN.test(id) ? id : null;
}

interface CoreInfo {
  element: Element | null;
  tag: CoreTag;
  inHead: boolean;
}
function findCore(document: SourceDocument): CoreInfo {
  const scripts = document.elements.filter(isScript);
  const index = scripts.findIndex(isCore);
  const element = index < 0 ? null : scripts[index]!;
  if (!element) return { element, tag: { present: false, first: false, inline: false, src: null }, inHead: false };
  const external = isExternalCore(element);
  return {
    element,
    tag: { present: true, first: index === 0, inline: !external, src: external ? attribute(element, "src") : null },
    inHead: Boolean(document.head && hasAncestor(element, document.head)),
  };
}

type MetaRead =
  | { kind: "missing" }
  | { kind: "invalid"; element: Element }
  | { kind: "ok"; element: Element; meta: PageMeta; start: number; end: number; text: string };

function readJsonBlock(document: SourceDocument, element: Element): { value: unknown; start: number; end: number; text: string } | null {
  const content = rawContent(document.source, element);
  if (!content) return null;
  try {
    return { value: JSON.parse(content.text) as unknown, ...content };
  } catch {
    return null;
  }
}
const isObject = (value: unknown): value is AfJsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readMeta(document: SourceDocument): MetaRead {
  const element = document.elements.find(isMetaBlock);
  if (!element) return { kind: "missing" };
  const block = readJsonBlock(document, element);
  if (!block || !isObject(block.value)) return { kind: "invalid", element };
  return { kind: "ok", element, meta: block.value as PageMeta, start: block.start, end: block.end, text: block.text };
}

function readBackends(document: SourceDocument): BackendLink[] {
  return document.elements.filter(isBackendLink).map((element) => {
    const href = attribute(element, "href") ?? "";
    return {
      name: attribute(element, AF_BACKEND_NAME_ATTRIBUTE) ?? "",
      href,
      id: backendId(href),
      line: startLine(element),
    };
  });
}

function readDesignSystem(document: SourceDocument): DesignSystemName | null {
  const value = document.html ? attribute(document.html, AF_DESIGN_SYSTEM_ATTRIBUTE) : null;
  return value && (DESIGN_SYSTEMS as readonly string[]).includes(value) ? (value as DesignSystemName) : null;
}

const nodeIdOf = (element: Element) => attribute(element, AF_NODE_ID_ATTRIBUTE);

export function parsePage(html: string): ParsedPage {
  const document = parseSource(html);
  const meta = readMeta(document);
  return {
    meta: meta.kind === "ok" ? meta.meta : null,
    core: findCore(document).tag,
    backends: readBackends(document),
    designSystem: readDesignSystem(document),
    nodeIds: document.elements.map(nodeIdOf).filter((id): id is string => id !== null),
  };
}

// ---------------------------------------------------------------------------
// Check

/** True when a script or stylesheet URL is on a known CDN without an exact version. */
function unpinnedCdn(value: string | null): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value.trim(), URL_BASE);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!(KNOWN_CDN_HOSTS as readonly string[]).includes(host)) return false;
  if (host === "cdnjs.cloudflare.com") {
    const version = /^\/ajax\/libs\/[^/]+\/([^/]+)\//.exec(url.pathname)?.[1];
    return !(version && EXACT_VERSION.test(version));
  }
  const versions = [...url.pathname.matchAll(/[^/@]@([^/@]*)/g)].map((match) => match[1]!);
  return !(versions.length > 0 && versions.every((version) => EXACT_VERSION.test(version)));
}

function backendNameProblem(name: string): PageProblemCode | null {
  if (!name) return "backend-name-missing";
  if (!GRAPHQL_NAME.test(name) || name.startsWith("__")) return "backend-name-invalid";
  return null;
}

function backendProblems(document: SourceDocument): PageProblem[] {
  const problems: PageProblem[] = [];
  const names = new Set<string>();
  for (const element of document.elements.filter(isBackendLink)) {
    const line = startLine(element);
    const name = attribute(element, AF_BACKEND_NAME_ATTRIBUTE) ?? "";
    const nameProblem = backendNameProblem(name);
    if (nameProblem === "backend-name-missing")
      problems.push({ code: nameProblem, line, message: 'Backend link needs a data-af-name, the namespace the page queries it under.' });
    else if (nameProblem === "backend-name-invalid")
      problems.push({ code: nameProblem, line, message: `Backend name "${name}" must be a GraphQL name: letters, digits and _, not starting with a digit or __.` });
    else if (names.has(name))
      problems.push({ code: "backend-name-duplicate", line, message: `Backend name "${name}" is already used by another link on this page.` });
    if (name) names.add(name);
    if (!backendId(attribute(element, "href")))
      problems.push({
        code: "backend-href-invalid",
        line,
        message: `Backend href must be a file address, https://<host>${AF_IDS_PATH}<id> with a six-character ID; run "node scripts/add.mjs <file>" to get one.`,
      });
  }
  return problems;
}

export function checkPage(html: string): PageProblem[] {
  const document = parseSource(html);
  const problems: PageProblem[] = [];
  const core = findCore(document);
  if (!core.element)
    problems.push({
      code: "core-missing",
      line: document.head && written(document.head) ? startLine(document.head) : 1,
      message: `Add <script src="${DEFAULT_AF_ORIGIN}${AF_CORE_PATH}"></script> as the first script in <head>.`,
    });
  else if (!core.tag.first || !core.inHead)
    problems.push({ code: "core-not-first", line: startLine(core.element), message: "The core script must be the first script in <head>, before any other script." });

  let metaSeen = false;
  const nodeIds = new Set<string>();
  for (const element of document.elements) {
    const line = startLine(element);
    if (isMetaBlock(element)) {
      if (metaSeen) problems.push({ code: "meta-duplicate", line, message: 'Only one <script type="application/json" data-af="meta"> block is allowed; merge them.' });
      else {
        const block = readJsonBlock(document, element);
        if (!block || !isObject(block.value))
          problems.push({ code: "meta-invalid-json", line, message: "The metadata block must contain one valid JSON object." });
      }
      metaSeen = true;
    }
    if (isScript(element) && nodeIdOf(element) === AF_META_MARKER)
      problems.push({ code: "meta-legacy-marker", line, message: 'Use data-af="meta" for the metadata block; data-af-id is only for node IDs.' });
    if (isDesignSystemLink(element))
      problems.push({ code: "design-system-link", line, message: 'Remove this link: the core adds the design system\'s CSS. Set data-af-design-system on <html> to choose one.' });
    if (isScript(element) && (attribute(element, "type") ?? "").trim().toLowerCase() === "importmap")
      problems.push({
        code: "author-importmap",
        line,
        warning: true,
        message: "Don't ship your own import map: the core adds one for @afbin/apollo, and Firefox uses only the first import map on a page. Import libraries by full URL instead.",
      });
    const src = isScript(element) ? attribute(element, "src") : null;
    const href = element.tagName === "link" && relTokens(element).includes("stylesheet") ? attribute(element, "href") : null;
    if (unpinnedCdn(src ?? href))
      problems.push({ code: "unpinned-cdn", line, message: `Pin an exact version (x.y.z) in ${src ?? href}.` });
    const id = nodeIdOf(element);
    if (id && id !== AF_META_MARKER) {
      if (nodeIds.has(id))
        problems.push({ code: "duplicate-node-id", line, message: `data-af-id="${id}" is already used by an earlier element; every node ID must be unique.` });
      nodeIds.add(id);
    }
  }
  problems.push(...backendProblems(document));
  return problems.map((problem, index) => ({ problem, index }))
    .sort((a, b) => a.problem.line - b.problem.line || a.index - b.index)
    .map(({ problem }) => problem);
}

// ---------------------------------------------------------------------------
// Node IDs

function positiveInteger(value: AfJson | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function metaBlockTag(entries: readonly (readonly [string, AfJson])[]): string {
  const body = entries.map(([key, value]) => `${scriptJson(key)}: ${scriptJson(value)}`).join(", ");
  return `<script type="application/json" data-af="${AF_META_MARKER}">{ ${body} }</script>`;
}

/** An edit that writes meta keys, creating the block right after the core when there is none. */
function metaEdit(document: SourceDocument, entries: readonly (readonly [string, AfJson])[]): Edit | null {
  const meta = readMeta(document);
  if (meta.kind === "invalid")
    throw new PageError("meta-invalid-json", startLine(meta.element), "The metadata block must contain one valid JSON object.");
  if (meta.kind === "ok") {
    const text = setMembers(meta.text, entries);
    return text === meta.text ? null : { start: meta.start, end: meta.end, text };
  }
  const core = findCore(document).element;
  const tag = metaBlockTag(entries);
  return core && written(core) ? afterElement(document.source, core, [tag]) : atHeadStart(document, [tag]);
}

/** The largest k among platform-assigned IDs (`n<k>`) in `ids`, or 0. */
function highestNodeId(ids: Iterable<string>): number {
  let highest = 0;
  for (const id of ids) {
    const match = /^n([1-9]\d{0,9})$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

export function assignNodeIds(html: string, options: AssignOptions = {}): AssignResult {
  const document = parseSource(html);
  const meta = readMeta(document);
  if (meta.kind === "invalid")
    throw new PageError("meta-invalid-json", startLine(meta.element), "The metadata block must contain one valid JSON object.");
  const used = new Set<string>(options.reserved ?? []);
  for (const element of [...document.elements, ...document.templateElements]) {
    const id = nodeIdOf(element);
    if (id) used.add(id);
  }
  let next = (meta.kind === "ok" ? positiveInteger(meta.meta.nextNodeId) : null) ?? 1;
  const fresh = () => {
    while (used.has(`${AF_NODE_ID_PREFIX}${next}`)) next++;
    const id = `${AF_NODE_ID_PREFIX}${next++}`;
    used.add(id);
    return id;
  };
  const body = document.body;
  const seen = new Set<string>();
  const edits: Edit[] = [];
  const changes: NodeIdChange[] = [];
  for (const element of document.elements) {
    const id = nodeIdOf(element);
    if (id && !seen.has(id)) {
      seen.add(id);
      continue;
    }
    const eligible =
      body !== null && written(element) && !SKIPPED_TAGS.has(element.tagName) && hasAncestor(element, body);
    if (!eligible) continue;
    const assigned = fresh();
    edits.push(
      id === null
        ? insertAttribute(html, element, AF_NODE_ID_ATTRIBUTE, assigned)
        : setAttribute(html, element, AF_NODE_ID_ATTRIBUTE, assigned)!,
    );
    changes.push({ id: assigned, tag: element.tagName, line: startLine(element) });
  }
  if (!changes.length) return { source: html, changes, nextNodeId: next };
  const written_ = metaEdit(document, [["nextNodeId", next]]);
  if (written_) edits.push(written_);
  return { source: applyEdits(html, edits), changes, nextNodeId: next };
}

// ---------------------------------------------------------------------------
// Hosts and core

const trimOrigin = (origin: string) => origin.replace(/\/+$/, "");

export function rewriteHosts(html: string, from: readonly string[], to: string): string {
  const target = trimOrigin(to);
  const origins = from.map(trimOrigin).filter((origin) => origin && origin !== target);
  if (!origins.length) return html;
  const document = parseSource(html);
  const edits: Edit[] = [];
  for (const element of [...document.elements, ...document.templateElements])
    for (const name of ["src", "href"]) {
      const value = attribute(element, name);
      const start = attributeValueStart(html, element, name);
      if (value === null || start === null) continue;
      const origin = origins.find((o) => value.startsWith(o + AF_PATH_PREFIX) && html.startsWith(o + AF_PATH_PREFIX, start));
      if (origin) edits.push({ start, end: start + origin.length, text: target });
    }
  return applyEdits(html, edits);
}

const coreScriptTag = (origin: string) => `<script src="${trimOrigin(origin)}${AF_CORE_PATH}"></script>`;

/**
 * Put `tag` (the core) first in <head>, followed by `after` on their own
 * lines. A core that is already first is replaced in place; otherwise it is
 * removed and the tag is inserted at the start of <head>.
 */
function placeCore(html: string, tag: string, after: readonly string[]): string {
  const document = parseSource(html);
  const core = findCore(document);
  if (core.element && written(core.element) && core.tag.first && core.inHead) {
    const location = core.element.sourceCodeLocation!;
    const indent = lineIndent(html, location.startOffset);
    const text = tag + after.map((line) => (indent === null ? line : `\n${indent}${line}`)).join("");
    return applyEdits(html, [{ start: location.startOffset, end: location.endOffset, text }]);
  }
  const edits: Edit[] = [];
  if (core.element && written(core.element)) edits.push(removeElement(html, core.element));
  edits.unshift(atHeadStart(document, [tag, ...after]));
  return applyEdits(html, edits);
}

export function ensureCore(html: string, origin: string): string {
  let core = findCore(parseSource(html));
  const src = core.element && attribute(core.element, "src");
  const start = core.element && attributeValueStart(html, core.element, "src");
  if (src?.trim().startsWith("/") && !src.trim().startsWith("//") && start != null) {
    html = applyEdits(html, [{ start, end: start + src.length, text: trimOrigin(origin) + src.trim() }]);
    core = findCore(parseSource(html));
  }
  if (core.tag.present && core.tag.first && core.inHead && !core.tag.inline) return html;
  const location = core.element?.sourceCodeLocation;
  const tag = location && !core.tag.inline ? html.slice(location.startOffset, location.endOffset) : coreScriptTag(origin);
  return placeCore(html, tag, []);
}

// ---------------------------------------------------------------------------
// Save and download

interface Stripped {
  source: string;
  state: AfJsonObject | null;
}

/** Remove platform-owned markup: data-af-dark (optionally), design-system links and state blocks. */
function stripPlatformMarkup(html: string, removeDark: boolean): Stripped {
  const document = parseSource(html);
  const edits: Edit[] = [];
  let state: AfJsonObject | null = null;
  let stateSeen = false;
  if (removeDark && document.html) {
    const edit = removeAttribute(html, document.html, AF_DARK_ATTRIBUTE);
    if (edit) edits.push(edit);
  }
  for (const element of document.elements) {
    if (!written(element)) continue;
    if (isDesignSystemLink(element)) edits.push(removeElement(html, element));
    else if (isStateBlock(element)) {
      if (!stateSeen) {
        const block = readJsonBlock(document, element);
        if (!block || !isObject(block.value))
          throw new PageError("malformed", startLine(element), 'The data-af="state" block must contain one JSON object.');
        state = block.value;
        stateSeen = true;
      }
      edits.push(removeElement(html, element));
    }
  }
  return { source: applyEdits(html, edits), state };
}

export function prepareForSave(html: string, context: SaveContext): PreparedPage {
  const document = parseSource(html);
  const meta = readMeta(document);
  if (meta.kind === "invalid")
    throw new PageError("meta-invalid-json", startLine(meta.element), "The metadata block must contain one valid JSON object.");
  for (const problem of backendProblems(document))
    if (problem.code !== "backend-href-invalid") throw new PageError(problem.code, problem.line, problem.message);

  let source = ensureCore(html, context.origin);
  source = rewriteHosts(source, context.knownOrigins, context.origin);
  const stripped = stripPlatformMarkup(source, true);
  source = stripped.source;
  const parsed_ = parseSource(source);
  const current = readMeta(parsed_);
  const inUse = new Set<string>(context.reserved ?? []);
  for (const element of [...parsed_.elements, ...parsed_.templateElements]) {
    const id = nodeIdOf(element);
    if (id) inUse.add(id);
  }
  const nextNodeId = Math.max(
    (current.kind === "ok" ? positiveInteger(current.meta.nextNodeId) : null) ?? 1,
    context.previousNextNodeId && context.previousNextNodeId >= 1 ? Math.floor(context.previousNextNodeId) : 1,
    highestNodeId(inUse) + 1,
  );
  const edit = metaEdit(parseSource(source), [
    ["id", context.id],
    ["version", context.version],
    ["nextNodeId", nextNodeId],
  ]);
  if (edit) source = applyEdits(source, [edit]);
  source = assignNodeIds(source, context.reserved ? { reserved: context.reserved } : {}).source;
  const parsed = parsePage(source);
  return { source, meta: parsed.meta ?? {}, backends: parsed.backends, nodeIds: parsed.nodeIds, state: stripped.state };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    output += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    output += c === undefined ? "=" : BASE64[c & 63]!;
  }
  return output;
}

/** Inline script text that cannot end its own element early. */
const inlineScript = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** A design system's CSS as the `data:` URL of its inline `data-af="design-system"` link. */
export function designSystemDataUrl(css: string): string {
  return `data:text/css;base64,${base64(css)}`;
}

export function toPortable(html: string, assets: PortableAssets): string {
  let source = stripPlatformMarkup(html, false).source;
  const after = [
    `<link rel="stylesheet" data-af="${AF_DESIGN_SYSTEM_MARKER}" href="${designSystemDataUrl(assets.designSystemCss)}">`,
  ];
  if (assets.state) after.push(`<script type="application/json" data-af="${AF_STATE_MARKER}">${scriptJson(assets.state)}</script>`);
  // Where the file came from and which version it is: how a browser that can reach the server reconnects it.
  const identity = [
    ...(assets.server ? [` ${AF_SERVER_ATTRIBUTE}="${escapeAttribute(assets.server)}"`] : []),
    ...(assets.revision ? [` ${AF_REVISION_ATTRIBUTE}="${escapeAttribute(assets.revision)}"`] : []),
  ].join("");
  source = placeCore(source, `<script data-af="${AF_INLINE_CORE_MARKER}"${identity}>${inlineScript(assets.core)}</script>`, after);
  const edit = setHtmlAttribute(parseSource(source), AF_DESIGN_SYSTEM_ATTRIBUTE, assets.designSystem);
  return edit ? applyEdits(source, [edit]) : source;
}
