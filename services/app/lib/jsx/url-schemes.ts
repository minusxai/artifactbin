/**
 * The URL scheme check every gate shares: the save-time validator (./validate), the render-time
 * prop filter (lib/story-ui/interpreter-primitives), paste (lib/data/story/jsx-edit) and the author
 * realm's attribute wrapper (./attribute-policy). One module, so the gates cannot drift
 * (see ./url-attrs.ts for why that matters).
 */
import { urlListUrls } from './url-attrs';

// `data:image/...` is allowed (inline images); other `data:` (e.g. text/html) is not.
const DANGEROUS_URL = /^(javascript|vbscript|data):/i;
const SAFE_DATA_URL = /^data:image\//i;

/**
 * True when a URL value carries a dangerous scheme. Browsers strip ASCII control chars and
 * spaces INSIDE the scheme before resolving (`java\tscript:` runs as `javascript:`), so the
 * check normalizes the same way instead of trusting the raw string.
 */
export function hasDangerousScheme(url: string): boolean {
  // eslint-disable-next-line no-control-regex -- deliberately mirrors browser scheme normalization
  const normalized = url.replace(/[\x00-\x20]/g, '');
  return DANGEROUS_URL.test(normalized) && !SAFE_DATA_URL.test(normalized);
}

/** Check ping's ASCII-whitespace-separated URLs or srcset's comma-separated URL/descriptor entries. */
export function listHasDangerousScheme(value: string, lowerAttributeName: string): boolean {
  return urlListUrls(value, lowerAttributeName).some(hasDangerousScheme);
}
