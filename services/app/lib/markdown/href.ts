/**
 * Which addresses a link or an image may carry: one rule for every surface. Both are checked on the address as
 * markdown-it normalizes it (entities decoded, then percent-encoded), after removing what a browser ignores inside
 * a scheme (C0 controls, spaces, DEL, and their percent forms), so `java&Tab;script:` and `java\tscript:` are the
 * scheme they hide. A backslash counts as a slash, as browsers read it.
 *
 * - Links: http, https, mailto, tel, or relative (no scheme). Protocol-relative `//host` is another host, not a
 *   relative address, so it is refused.
 * - Images: https, relative (not `//host`), or an upload `ref:<id>`.
 */
import { ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts/artifact-reference';

const HIDDEN = /[\x00-\x20\x7f]|%(?:[01][0-9a-f]|20|7f)/gi;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const PROTOCOL_RELATIVE = /^(?:[\\/]|%5c){2}/i;
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

const scheme = (clean: string): string | null => SCHEME.exec(clean)?.[1]!.toLowerCase() ?? null;

export function linkAllowed(href: string): boolean {
  const clean = href.replace(HIDDEN, '');
  const name = scheme(clean);
  return name ? LINK_SCHEMES.has(name) : !PROTOCOL_RELATIVE.test(clean);
}

export function imageAllowed(src: string): boolean {
  if (ARTIFACT_REFERENCE_PATTERN.test(src)) return true;
  const clean = src.replace(HIDDEN, '');
  const name = scheme(clean);
  return name ? name === 'https' : !PROTOCOL_RELATIVE.test(clean);
}
