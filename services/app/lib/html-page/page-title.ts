/**
 * A page's NAME as its source states it: the text of its first `<h1>` and its `<title>`. Pure and source-preserving
 * (./html-source): renaming splices the title's text and leaves every other byte as it was. A doc's title follows its
 * heading through these (lib/artifacts doc-title).
 * Explicit .ts specifiers: the skill scripts load this module directly under Node in a source checkout.
 */
import { escapeText } from '@artifactbin/utils/escape';
import type { DefaultTreeAdapterMap } from 'parse5';
import { applyEdits, atHeadStart, parseSource, type Element } from './html-source.ts';

type Node = DefaultTreeAdapterMap['node'];
const textOf = (node: Node): string => node.nodeName === '#text' ? (node as DefaultTreeAdapterMap['textNode']).value : 'childNodes' in node ? node.childNodes.map(textOf).join('') : '';
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const inside = (element: Element, ancestor: Element | null): boolean => { for (let at = element.parentNode as Node | null; at; at = 'parentNode' in at ? at.parentNode as Node | null : null) if (at === ancestor) return true; return false; };

/** The text of the page's first `<h1>` in its body, whitespace collapsed; '' when there is none or it is empty. */
export function firstHeadingText(html: string): string {
  const document = parseSource(html);
  const heading = document.elements.find((element) => element.tagName === 'h1' && inside(element, document.body));
  return heading ? squash(textOf(heading)) : '';
}

/** The page with its `<title>` saying `title` (the first one in <head>; one is added at the head's start when missing). */
export function withPageTitle(html: string, title: string): string {
  const document = parseSource(html);
  const element = document.elements.find((candidate) => candidate.tagName === 'title' && inside(candidate, document.head));
  const text = escapeText(title);
  const location = element?.sourceCodeLocation;
  if (location?.startTag && location.endTag) return applyEdits(html, [{ start: location.startTag.endOffset, end: location.endTag.startOffset, text }]);
  return applyEdits(html, [atHeadStart(document, [`<title>${text}</title>`])]);
}
