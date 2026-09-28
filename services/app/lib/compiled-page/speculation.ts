/**
 * THE PRERENDER RULES a compiled page names (docs/phase2-architecture.md §8).
 *
 * Chrome loads EXTERNAL speculation rules only through the `Speculation-Rules`
 * response header, and an inline `<script type="speculationrules">` would need
 * `'inline-speculation-rules'` in a CSP that stays `script-src 'self'`. So the
 * rules are a content-addressed JSON file (`/islands/s/<sha>.json`): this module
 * is the ONE place their text and address are derived, pure, so the assembler
 * (which only names the file) and the module store (which writes it) can never
 * disagree about which bytes a sha names.
 */
import { createHash } from 'node:crypto';
import { ISLANDS_PATH, PRERENDER_LIMIT } from './contract';

/** Where speculation-rule files are served (`/islands/s/<sha>.json`). */
export const SPECULATION_RULES_PATH = `${ISLANDS_PATH}/s`;
/** The media type Chrome requires of an external rule set. */
export const SPECULATION_RULES_CONTENT_TYPE = 'application/speculationrules+json';

/** One rule file: its exact text, its content address and the URL the header names. */
export interface SpeculationRules {
  text: string;
  sha: string;
  url: string;
}

/** `sha256(bytes)` hex, first 16 — the same identity a per-document module carries (ModuleRef.sha). */
export const contentSha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** A hint the page may name: a root-relative path or an http(s) URL, never another scheme. */
export const isNavigable = (url: string): boolean => (url.startsWith('/') && !url.startsWith('//')) || /^https?:\/\/[^/\\]/i.test(url);

/**
 * The rule set for a page's prerender hints, or null when there is nothing to
 * prerender. Root-relative paths and http(s) URLs only (links.ts emits
 * nothing else; this re-checks rather than trusts — a rule file must never
 * carry a `javascript:` or `data:` URL), deduplicated in document order,
 * at most PRERENDER_LIMIT, `eagerness: moderate` so hover or pointer-down
 * triggers them and a page full of links does not prerender them all on load.
 */
export function speculationRulesOf(prerender: readonly string[]): SpeculationRules | null {
  const urls = [...new Set(prerender.filter(isNavigable))].slice(0, PRERENDER_LIMIT);
  if (!urls.length) return null;
  const text = JSON.stringify({ prerender: [{ source: 'list', urls, eagerness: 'moderate' }] });
  const sha = contentSha(text);
  return { text, sha, url: `${SPECULATION_RULES_PATH}/${sha}.json` };
}
