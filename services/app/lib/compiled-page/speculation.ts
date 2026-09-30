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
import { ISLANDS_PATH, PRERENDER_LIMIT, type LinkHints } from './contract';

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
 * The rule set for a page's link hints, or null when there is nothing to
 * hint. Root-relative paths and http(s) URLs only (links.ts emits nothing
 * else; this re-checks rather than trusts — a rule file must never carry a
 * `javascript:` or `data:` URL), deduplicated in document order. Every hint
 * — `prefetch`'s full list and `prerender`'s first PRERENDER_LIMIT — carries
 * `eagerness: moderate`, so a 200ms hover or a pointer-down triggers it and
 * a page full of links fetches none of them just by loading (size target 3):
 * this is the ONLY way a link hint reaches the network, never an eager
 * `<link rel="prefetch">` in the head.
 */
export function speculationRulesOf(links: LinkHints): SpeculationRules | null {
  const prefetch = [...new Set(links.prefetch.filter(isNavigable))];
  const prerender = [...new Set(links.prerender.filter(isNavigable))].slice(0, PRERENDER_LIMIT);
  if (!prefetch.length && !prerender.length) return null;
  const rules: { prefetch?: unknown[]; prerender?: unknown[] } = {};
  if (prefetch.length) rules.prefetch = [{ source: 'list', urls: prefetch, eagerness: 'moderate' }];
  if (prerender.length) rules.prerender = [{ source: 'list', urls: prerender, eagerness: 'moderate' }];
  const text = JSON.stringify(rules);
  const sha = contentSha(text);
  return { text, sha, url: `${SPECULATION_RULES_PATH}/${sha}.json` };
}
