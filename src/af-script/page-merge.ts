/**
 * Page-aware edits for publish.mjs, on the page model's own parser: the
 * platform-owned meta members, and node IDs when two sides are merged.
 */
import { applyEdits, attribute, parseSource, rawContent, removeAttribute, type Edit } from "../page/html-source.ts";
import { removeMembers, setMembers } from "../page/json-members.ts";
import { isMetaBlock } from "../page/markers.ts";
import { AF_NODE_ID_ATTRIBUTE, type AfJson } from "../af-contracts.ts";
import { merge3, type MergeResult } from "./merge.ts";

/** Members the platform writes; the author never edits them. */
export const PLATFORM_META = ["id", "version", "nextNodeId"] as const;

/** Apply `change` to the meta block's JSON text; the source is unchanged when there is no valid block. */
function editMeta(source: string, change: (text: string, meta: Record<string, AfJson>) => string): string {
  const document = parseSource(source);
  const element = document.elements.find(isMetaBlock);
  const content = element && rawContent(source, element);
  if (!content) return source;
  let meta: unknown;
  try {
    meta = JSON.parse(content.text);
  } catch {
    return source;
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return source;
  const text = change(content.text, meta as Record<string, AfJson>);
  return text === content.text ? source : applyEdits(source, [{ start: content.start, end: content.end, text }]);
}

/** The page's meta object, or null. */
export function readMeta(source: string): Record<string, AfJson> | null {
  let found: Record<string, AfJson> | null = null;
  editMeta(source, (text, meta) => ((found = meta), text));
  return found;
}

/** For --new: the page without its identity (id, version, nextNodeId). Node IDs stay. */
export function stripIdentity(source: string): string {
  return editMeta(source, (text) => removeMembers(text, PLATFORM_META));
}

/** Give `source` the platform members `from` has, so they never differ in a merge. */
export function adoptPlatformMeta(source: string, from: string): string {
  const values = readMeta(from);
  if (!values) return source;
  const entries = PLATFORM_META.filter((key) => values[key] !== undefined).map((key) => [key, values[key]!] as const);
  return entries.length ? editMeta(source, (text) => setMembers(text, entries)) : source;
}

/** Start tag text of every element with a data-af-id, by ID (the first wins). */
function idTags(source: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const element of parseSource(source).elements) {
    const id = attribute(element, AF_NODE_ID_ATTRIBUTE);
    const tag = element.sourceCodeLocation?.startTag;
    if (id !== null && tag && !tags.has(id)) tags.set(id, source.slice(tag.startOffset, tag.endOffset));
  }
  return tags;
}

/**
 * IDs both sides added since `base` for different elements: drop them from
 * `ours`, so the other side's elements (and any comments on them) keep their
 * IDs and ours get new ones on the next save.
 */
export function dropCollidingIds(base: string, ours: string, theirs: string): string {
  const before = idTags(base),
    mine = idTags(ours),
    others = idTags(theirs);
  const colliding = new Set<string>();
  for (const [id, tag] of mine) if (!before.has(id) && others.has(id) && others.get(id) !== tag) colliding.add(id);
  if (!colliding.size) return ours;
  const edits: Edit[] = [];
  for (const element of parseSource(ours).elements) {
    const id = attribute(element, AF_NODE_ID_ATTRIBUTE);
    if (id !== null && colliding.has(id)) {
      const edit = removeAttribute(ours, element, AF_NODE_ID_ATTRIBUTE);
      if (edit) edits.push(edit);
    }
  }
  return applyEdits(ours, edits);
}

/**
 * Merge two versions of a page from their common ancestor. The platform's
 * meta members follow `theirs` (the server's head), and node IDs are kept.
 */
export function mergePages(base: string, ours: string, theirs: string): MergeResult {
  const ancestor = adoptPlatformMeta(base, theirs);
  const mine = dropCollidingIds(ancestor, adoptPlatformMeta(ours, theirs), theirs);
  return merge3(ancestor, mine, theirs);
}
