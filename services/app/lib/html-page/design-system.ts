/**
 * DESIGN SELECTION for HTML pages (D1/D2/D4). A page names its default design system with
 * `<meta name="artifactbin:design-system" content="NAME">` in <head>. The <html data-af-design-system / data-af-dark>
 * attributes belong to the platform: the core runtime sets them at load (lib/html-runtime/build.server) and the platform
 * stylesheet (lib/html-systems) supplies every system, so a copied `<link data-af="design-system">` is redundant.
 *
 * `normalizeDesignSelection` is the publish-time rule (autofix and the server's canonicalizeHtmlPage share it): it
 * moves agent-written attributes into the meta and removes the copied stylesheet link. `htmlAppearance` resolves what
 * the core applies, including pages stored before the rule existed (their attributes act as the defaults).
 * Explicit .ts specifiers: the skill scripts load this module directly under Node in a source checkout.
 */
import {applyEdits,atHeadStart,attribute,parseSource,removeElement,type Edit,type Element,type SourceDocument} from './html-source.ts';
import {HTML_SYSTEM_MODES} from '../validation/html-system-modes.ts';

const DESIGN_SYSTEM_META = 'artifactbin:design-system';
const known = (name: string | null | undefined): name is string => !!name && Object.hasOwn(HTML_SYSTEM_MODES, name);
const inHead = (element: Element, head: Element | null): boolean => { for (let at = element.parentNode as unknown as Element | null; at; at = at.parentNode as unknown as Element | null) if (at === head) return true; return false; };
const metaOf = (document: SourceDocument): Element | undefined => document.elements.find((el) => el.tagName === 'meta' && (attribute(el, 'name') ?? '').toLowerCase() === DESIGN_SYSTEM_META && inHead(el, document.head));
const copiedLinks = (document: SourceDocument): Element[] => document.elements.filter((el) => el.tagName === 'link' && attribute(el, 'data-af') === 'design-system');
/** The system a copied skill stylesheet names: `…/design-systems/NAME.css`. */
const linkedSystem = (link: Element): string | null => /(?:^|\/)design-systems\/([a-z0-9-]+)\.css(?:[?#]|$)/.exec(attribute(link, 'href') ?? '')?.[1] ?? null;
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const designSystemMetaTag = (name: string): string => `<meta name="${DESIGN_SYSTEM_META}" content="${escape(name)}">`;

interface DesignNormalization {
  html: string;
  changed: boolean;
  /** The <html> start tag before, when platform attributes were removed from it. */
  rootBefore?: { line: number; text: string };
  /** The meta inserted for a removed (or link-implied) system name. */
  insertedMeta?: string;
  /** Start tags of removed copied design-system stylesheet links, with their lines. */
  removedLinks: Array<{ line: number; text: string }>;
}

const startTag = (source: string, element: Element): string => { const tag = element.sourceCodeLocation?.startTag; return tag ? source.slice(tag.startOffset, tag.endOffset) : `<${element.tagName}>`; };
const lineOf = (element: Element): number => element.sourceCodeLocation?.startLine ?? 0;

/** D2: no platform attributes on <html>; the system lives in the head meta; no copied system stylesheet. Idempotent. */
export function normalizeDesignSelection(input: string): DesignNormalization {
  const document = parseSource(input);
  const root = document.html, meta = metaOf(document), links = copiedLinks(document);
  const dark = root?.sourceCodeLocation?.attrs?.['data-af-dark'], design = root?.sourceCodeLocation?.attrs?.['data-af-design-system'];
  const attrName = root ? attribute(root, 'data-af-design-system')?.trim() || null : null;
  const metaName = meta ? attribute(meta, 'content')?.trim() || null : null;
  const linkName = links.map(linkedSystem).find(known) ?? null;
  const name = metaName ?? attrName ?? linkName;
  const edits: Edit[] = [];
  const result: DesignNormalization = { html: input, changed: false, removedLinks: [] };
  if (root && (dark || design)) {
    result.rootBefore = { line: lineOf(root), text: startTag(input, root) };
    for (const at of [dark, design]) if (at) { let start = at.startOffset; while (start > 0 && /\s/.test(input[start - 1]!)) start--; edits.push({ start, end: at.endOffset, text: '' }); }
  }
  if (!meta && name && (attrName || known(name))) { result.insertedMeta = designSystemMetaTag(name); edits.push(atHeadStart(document, [result.insertedMeta])); }
  // The platform stylesheet carries every system: a copied one is dropped once the page names a system we serve.
  if (known(name)) for (const link of links) { result.removedLinks.push({ line: lineOf(link), text: startTag(input, link) }); edits.push(removeElement(input, link)); }
  if (!edits.length) return result;
  result.html = applyEdits(input, edits);
  result.changed = result.html !== input;
  return result;
}

/** What the core applies at load: the design system (when the page has one) and the default colour mode. */
interface HtmlAppearance { designSystem?: string; mode: 'light' | 'dark' }

/**
 * Owner's choice › the head meta › a stored <html data-af-design-system> (pages published before D2). The mode is a
 * stored <html data-af-dark> (until republished), else the system's own default, else light. The viewer's own
 * light/dark choice is applied on top by the core.
 */
export function htmlAppearance(html: string, ownerChoice?: string | null): HtmlAppearance {
  const document = parseSource(html), root = document.html, meta = metaOf(document);
  const metaName = meta ? attribute(meta, 'content')?.trim() : undefined;
  const attrName = root ? attribute(root, 'data-af-design-system')?.trim() : undefined;
  const designSystem = [ownerChoice, metaName, attrName].find(known);
  const stored = root ? attribute(root, 'data-af-dark') : null;
  const mode = stored === 'true' ? 'dark' : stored === 'false' ? 'light' : designSystem ? HTML_SYSTEM_MODES[designSystem]! : 'light';
  return { ...(designSystem ? { designSystem } : {}), mode };
}
