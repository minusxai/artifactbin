/**
 * DESIGN SELECTION for HTML pages (D1/D2/D4). A page names its default design system with
 * `<meta name="artifactbin:design-system" content="NAME">` in <head>. The <html data-af-design-system / data-af-dark>
 * attributes belong to the platform: the core runtime sets them at load (lib/html-runtime/build.server) and the platform
 * stylesheet (lib/html-systems) supplies every system, so a copied `<link data-af="design-system">` is redundant.
 *
 * `normalizeDesignSelection` is the publish-time rule (autofix and the server's canonicalizeHtmlPage share it): it
 * removes platform-owned attributes and copied stylesheet links. Only explicit head metadata selects the page default;
 * `htmlAppearance` resolves that metadata and the owner choice without interpreting old attributes.
 * Explicit .ts specifiers: the skill scripts load this module directly under Node in a source checkout.
 */
import {applyEdits,attribute,parseSource,removeElement,type Edit,type Element,type SourceDocument} from './html-source.ts';
import {HTML_SYSTEM_MODES} from '../validation/html-system-modes.ts';

const DESIGN_SYSTEM_META = 'artifactbin:design-system';
const known = (name: string | null | undefined): name is string => !!name && Object.hasOwn(HTML_SYSTEM_MODES, name);
const inHead = (element: Element, head: Element | null): boolean => { for (let at = element.parentNode as unknown as Element | null; at; at = at.parentNode as unknown as Element | null) if (at === head) return true; return false; };
const metaOf = (document: SourceDocument): Element | undefined => document.elements.find((el) => el.tagName === 'meta' && (attribute(el, 'name') ?? '').toLowerCase() === DESIGN_SYSTEM_META && inHead(el, document.head));
const copiedLinks = (document: SourceDocument): Element[] => document.elements.filter((el) => el.tagName === 'link' && attribute(el, 'data-af') === 'design-system');

interface DesignNormalization {
  html: string;
  changed: boolean;
  /** The <html> start tag before, when platform attributes were removed from it. */
  rootBefore?: { line: number; text: string };
  /** Start tags of removed copied design-system stylesheet links, with their lines. */
  removedLinks: Array<{ line: number; text: string }>;
}

const startTag = (source: string, element: Element): string => { const tag = element.sourceCodeLocation?.startTag; return tag ? source.slice(tag.startOffset, tag.endOffset) : `<${element.tagName}>`; };
const lineOf = (element: Element): number => element.sourceCodeLocation?.startLine ?? 0;

/** D2: no platform attributes on <html>; the system lives in the head meta; no copied system stylesheet. Idempotent. */
export function normalizeDesignSelection(input: string): DesignNormalization {
  const document = parseSource(input);
  const root = document.html, links = copiedLinks(document);
  const dark = root?.sourceCodeLocation?.attrs?.['data-af-dark'], design = root?.sourceCodeLocation?.attrs?.['data-af-design-system'];
  const edits: Edit[] = [];
  const result: DesignNormalization = { html: input, changed: false, removedLinks: [] };
  if (root && (dark || design)) {
    result.rootBefore = { line: lineOf(root), text: startTag(input, root) };
    for (const at of [dark, design]) if (at) { let start = at.startOffset; while (start > 0 && /\s/.test(input[start - 1]!)) start--; edits.push({ start, end: at.endOffset, text: '' }); }
  }
  for (const link of links) { result.removedLinks.push({ line: lineOf(link), text: startTag(input, link) }); edits.push(removeElement(input, link)); }
  if (!edits.length) return result;
  result.html = applyEdits(input, edits);
  result.changed = result.html !== input;
  return result;
}

/** What the core applies at load: the design system (when the page has one) and the default colour mode. */
interface HtmlAppearance { designSystem?: string; mode: 'light' | 'dark' }

/** Owner choice overrides explicit head metadata. The selected system supplies its default colour mode. */
export function htmlAppearance(html: string, ownerChoice?: string | null): HtmlAppearance {
  const document = parseSource(html), meta = metaOf(document);
  const metaName = meta ? attribute(meta, 'content')?.trim() : undefined;
  const designSystem = [ownerChoice, metaName].find(known);
  const mode = designSystem ? HTML_SYSTEM_MODES[designSystem]! : 'light';
  return { ...(designSystem ? { designSystem } : {}), mode };
}
