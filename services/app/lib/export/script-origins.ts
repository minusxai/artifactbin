/**
 * WHAT AN EXPORT RENDER OF A SCRIPT DOCUMENT MUST LET THROUGH. The renderer aborts every cross-origin request
 * (`sameOriginOnly`), which would stop a Helmet script at its first library import and leave every component mount on
 * its fallback. A document with a script admits the hosts its module loads from — the ESM CDN its bare names resolve
 * to (lib/story/document/author-module.server), and the host of each full-URL import — and the hosts the version's
 * Helmet declares for scripts and connections (`csp-script`, `csp-connect`, lib/document/csp-extensions): the
 * publisher's declared set is enough for a capture, no reader's consent is involved. Exact origins only (the
 * renderer's `allowedOrigins`): a declared `*.` wildcard is not admitted. Nothing else: whatever else the script
 * fetches at run time stays blocked in a capture. Empty for a document without a script.
 */
import type { PageRequest } from '@artifactbin/contracts';
import { parseJsx } from '@/lib/jsx/parse';
import { splitHelmet } from '@/lib/document/helmet';
import { ESM_CDN_ORIGIN } from '@/lib/story/document/author-module.server';
import { cspExtensionsOf } from '@/lib/document/csp-extensions';

/** Static `import … from '…'`, `export … from '…'`, bare `import '…'` and `import('…')` with a literal. */
const SPECIFIERS = /\b(?:import|export)\s+(?:[^'"`;]*?\s+from\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;

export function scriptModuleOrigins(source: string): string[] {
  const parsed = parseJsx(source);
  const split = parsed.ok ? splitHelmet(parsed.nodes) : null;
  const script = split?.content.script ?? null;
  if (!script) return [];
  const origins = new Set<string>([ESM_CDN_ORIGIN]);
  const declared = cspExtensionsOf(split!.content, split!.helmet).extensions;
  for (const origin of [...declared.script, ...declared.connect]) if (!origin.includes('*')) origins.add(origin);
  for (const match of script.matchAll(SPECIFIERS)) {
    const spec = match[2] ?? match[4] ?? '';
    if (!/^https:\/\//i.test(spec)) continue;
    try { origins.add(new URL(spec).origin); } catch { /* the build refuses a malformed URL; nothing to admit */ }
  }
  return [...origins];
}

/** How long a script document's components get to replace their fallback before the shot is taken anyway. */
const MOUNT_WAIT_MS = 5_000;

/**
 * What a render of a script document asks of the browser beyond its own origin: the module hosts `origins` names
 * (`scriptModuleOrigins`) admitted, and its component mounts waited for. Nothing for a document without a script.
 * One policy for the server's exporter (./exporter) and the CLI's local export (services/cli preview-render).
 */
export function scriptRenderAllowance(origins: readonly string[]): Pick<PageRequest, 'allowedOrigins' | 'waitForMountsMs'> {
  return origins.length ? { allowedOrigins: [...origins], waitForMountsMs: MOUNT_WAIT_MS } : {};
}
