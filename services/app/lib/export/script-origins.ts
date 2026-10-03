/**
 * WHAT AN EXPORT RENDER OF A SCRIPT DOCUMENT MUST LET THROUGH. The renderer aborts every cross-origin request
 * (`sameOriginOnly`), which would stop a Helmet script at its first library import and leave every component mount on
 * its fallback. A document with a script admits the hosts its module loads from — the ESM CDN its bare names resolve
 * to (lib/story/document/author-module.server), and the host of each full-URL import — and nothing else: whatever the
 * script fetches at run time stays blocked in a capture. Empty for a document without a script.
 */
import { parseJsx } from '@/lib/jsx/parse';
import { splitHelmet } from '@/lib/story/document/helmet';
import { ESM_CDN_ORIGIN } from '@/lib/story/document/author-module.server';

/** Static `import … from '…'`, `export … from '…'`, bare `import '…'` and `import('…')` with a literal. */
const SPECIFIERS = /\b(?:import|export)\s+(?:[^'"`;]*?\s+from\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;

export function scriptModuleOrigins(source: string): string[] {
  const parsed = parseJsx(source);
  const script = parsed.ok ? splitHelmet(parsed.nodes).content.script : null;
  if (!script) return [];
  const origins = new Set<string>([ESM_CDN_ORIGIN]);
  for (const match of script.matchAll(SPECIFIERS)) {
    const spec = match[2] ?? match[4] ?? '';
    if (!/^https:\/\//i.test(spec)) continue;
    try { origins.add(new URL(spec).origin); } catch { /* the build refuses a malformed URL; nothing to admit */ }
  }
  return [...origins];
}
