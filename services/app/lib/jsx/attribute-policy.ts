/**
 * WHAT AUTHOR CODE MAY SET ON THE PAGE AT RUNTIME (the author realm's `dom` API,
 * lib/story-runtime/author-realm). Stored markup is checked at save (./validate) and again at render
 * (lib/story-ui/interpreter-primitives); a script's writes happen after both, so they are checked here,
 * against the same denied names, URL schemes and paint references — plus what only a runtime could
 * touch and the page owns: node identity, hydration keys, the source path, editing and live-update marks.
 * Framework-free: it is bundled into the realm's lazy chunk.
 */
import { DENIED_JSX_ATTRS } from './denied-attrs';
import { DANGEROUS_TAGS } from './dangerous-tags';
import { SVG_PAINT_ATTRS, URL_ATTRS, URL_LIST_ATTRS, paintHasExternalUrl } from './url-attrs';
import { hasDangerousScheme, listHasDangerousScheme } from './url-schemes';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';

/** The longest attribute value a script may set. */
export const AUTHOR_ATTRIBUTE_LIMIT = 4096;
/** The longest class token a script may add, and the most per call. */
export const AUTHOR_CLASS_LIMIT = 128;
export const AUTHOR_CLASSES_PER_CALL = 32;

/** The page's own attributes: identity, styling (through classes), hydration and editing. */
const PAGE_OWNED = new Set(['id', 'class', 'style', 'slot', 'is', 'contenteditable', 'data-hk', 'nonce']);
const PAGE_OWNED_PREFIX = /^data-mx-/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;
/** Tailwind-shaped tokens included (`@2xl:px-8`, `w-[12px]`, `!mt-0`), never the runtime's own `mx-*`. */
const CLASS_RE = /^[-A-Za-z0-9_:@/.%!#[\]]+$/;

/** Why a script may not set `name` to `value`, or null when it may. Names are matched lowercased, as every gate does. */
export function authorAttributeRefusal(name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (!NAME_RE.test(lower)) return `attribute ${name} is not a plain attribute name`;
  if (lower.startsWith('on')) return `event handler attributes are not allowed (${name}); use dom.on`;
  if (DENIED_JSX_ATTRS.has(lower)) return `attribute ${name} is not allowed`;
  if (PAGE_OWNED.has(lower) || PAGE_OWNED_PREFIX.test(lower)) return `attribute ${name} belongs to the page; use dom.addClass, dom.setText or dom.setValue`;
  if (value.length > AUTHOR_ATTRIBUTE_LIMIT) return `attribute ${name} exceeds ${AUTHOR_ATTRIBUTE_LIMIT} characters`;
  if (URL_LIST_ATTRS.has(lower) ? listHasDangerousScheme(value, lower) : URL_ATTRS.has(lower) && hasDangerousScheme(value)) return `unsafe URL in ${name}`;
  if (SVG_PAINT_ATTRS.has(lower) && paintHasExternalUrl(value)) return `external paint reference in ${name}`;
  return null;
}

/** Why a script may not add or remove the class `token`, or null when it may. */
export function authorClassRefusal(token: string): string | null {
  if (!token || token.length > AUTHOR_CLASS_LIMIT || !CLASS_RE.test(token)) return `class ${JSON.stringify(token.slice(0, 40))} is not a class token`;
  if (/^mx-/.test(token)) return `class ${token} belongs to the page`;
  return null;
}

/**
 * The elements a script may create: the story's own HTML vocabulary without active content, media
 * (an imported image is served from a copy the server made at publish; a script cannot make one),
 * nested browsing contexts, the top layer and templates.
 */
const NOT_CREATABLE = new Set(['img', 'picture', 'source', 'track', 'video', 'audio', 'canvas', 'dialog', 'template', 'datalist']);
export const AUTHOR_ELEMENT_TAGS: ReadonlySet<string> = new Set(
  STORY_HTML_TAGS.map((tag) => tag.toLowerCase()).filter((tag) => !DANGEROUS_TAGS.has(tag) && !NOT_CREATABLE.has(tag)),
);
