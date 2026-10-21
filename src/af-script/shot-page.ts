/**
 * The temporary copies of a page that `shot.mjs` screenshots. With a
 * reachable server, `liveShotPage` keeps the core; otherwise `shotPage`
 * drops it and sets the design system and mode on <html> itself, with the
 * skill's local design-system CSS linked. Both add a <base> so the page's
 * relative URLs still resolve.
 */
import {
  AF_CORE_PATH,
  AF_DARK_ATTRIBUTE,
  AF_DESIGN_SYSTEM_ATTRIBUTE,
  AF_PATH_PREFIX,
  KNOWN_AF_ORIGINS,
} from "../af-contracts.ts";
import {
  applyEdits,
  atHeadStart,
  escapeAttribute,
  parseSource,
  removeAttribute,
  removeElement,
  setAttribute,
  written,
} from "../page/html-source.ts";
import type { Edit } from "../page/html-source.ts";
import { isCore, isDesignSystemLink } from "../page/markers.ts";

export interface ShotPageOptions {
  designSystem: string;
  dark: boolean;
  /** URL of the design system's CSS. */
  cssHref: string;
  /** URL of the original page's directory, ending in `/`. */
  baseHref: string;
}

export interface LiveShotPageOptions {
  /** The server the core and design systems load from, e.g. `http://127.0.0.1:8080`. */
  server: string;
  /** URL of the original page's directory, ending in `/`. */
  baseHref: string;
}

/**
 * The copy `shot` opens when a server is reachable: the page with its live
 * core, which applies the design system and mode from the URL's
 * `?af-dark=…&af-design-system=…`. Platform URLs point at `server`, a
 * missing core is added first in <head>, and a <base> keeps relative URLs.
 */
export function liveShotPage(source: string, options: LiveShotPageOptions): string {
  const server = options.server.replace(/\/+$/, "");
  // The same rewrite the server does on save: every known host's platform URLs point at `server`.
  for (const origin of KNOWN_AF_ORIGINS)
    if (origin !== server) source = source.replaceAll(`${origin}${AF_PATH_PREFIX}`, `${server}${AF_PATH_PREFIX}`);
  const document = parseSource(source);
  const tags = [`<base href="${escapeAttribute(options.baseHref)}">`];
  if (!document.elements.some((element) => written(element) && isCore(element)))
    tags.push(`<script src="${escapeAttribute(server + AF_CORE_PATH)}"></script>`);
  return applyEdits(source, [atHeadStart(document, tags)]);
}

export function shotPage(source: string, options: ShotPageOptions): string {
  let document = parseSource(source);
  const removals: Edit[] = [];
  for (const element of document.elements)
    if (written(element) && (isCore(element) || isDesignSystemLink(element))) removals.push(removeElement(source, element));
  if (document.html) {
    const dark = removeAttribute(source, document.html, AF_DARK_ATTRIBUTE);
    if (dark) removals.push(dark);
  }
  source = applyEdits(source, removals);

  document = parseSource(source);
  const attributes: [string, string][] = [[AF_DESIGN_SYSTEM_ATTRIBUTE, options.designSystem]];
  if (options.dark) attributes.push([AF_DARK_ATTRIBUTE, "true"]);
  const edits: Edit[] = [];
  const html = document.html;
  if (html && written(html)) {
    for (const [name, value] of attributes) {
      const edit = setAttribute(source, html, name, value);
      if (edit) edits.push(edit);
    }
  } else {
    const text = attributes.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
    edits.push({ start: document.doctypeEnd, end: document.doctypeEnd, text: `<html${text}>` });
  }
  edits.push(
    atHeadStart(document, [
      `<base href="${escapeAttribute(options.baseHref)}">`,
      `<link rel="stylesheet" href="${escapeAttribute(options.cssHref)}">`,
    ]),
  );
  return applyEdits(source, edits);
}
