/**
 * LINK HINTS (docs/phase2-architecture.md §8; contract `LinkHints`).
 *
 * Every `<a href>` in a version that names an artifact on THIS deployment —
 * `/a/<id>`, `/@user/<id>-slug`, or either absolute on one of the deployment's
 * origins — collected at compile, in document order, once each. The assembler
 * (lib/compiled-page/speculation) turns both `prefetch` and `prerender` (the
 * first `PRERENDER_LIMIT`) into ONE speculation-rules file, `eagerness:
 * moderate` throughout: nothing here reaches the network just from a page load.
 *
 * Only a static, same-deployment artifact address qualifies: an external host,
 * `mailto:`, `javascript:`, an anchor, a non-artifact path (`/login`, a
 * profile), an artifact sub-path (`/raw`, `/edit`) and a reactive href (`$…`,
 * or any expression) are ignored. The artifact grammar is the product's own
 * (`@artifactbin/utils/artifact-reference`). Emitted URLs are the parser's
 * serialisation without the fragment (so `/a/x#s` and `/a/x` are one hint, and
 * quotes and angle brackets arrive percent-encoded); relative hrefs stay
 * relative, absolute ones keep their origin.
 *
 * Pure: no I/O. Whether a linked artifact may be prerendered for a given reader
 * (a private one never is) is not knowable here and is the serve path's call.
 */
import type { JsxNode } from '@/lib/jsx';
import { artifactIdFromPath } from '@artifactbin/utils/artifact-reference';
import { PRERENDER_LIMIT, type LinkHints } from './contract';

/** The origin a relative href is resolved against only to parse it; never emitted. */
const PARSE_BASE = 'https://artifact.invalid';

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The hint for one href, or null when it does not name an artifact on this deployment. */
function hintFor(href: string, origins: ReadonlySet<string>): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith('$')) return null;
  const relative = raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\');
  let url: URL;
  try {
    url = new URL(raw, PARSE_BASE);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (relative ? url.origin !== PARSE_BASE : !origins.has(url.origin)) return null;
  if (!artifactIdFromPath(url.pathname)) return null;
  return `${relative ? '' : url.origin}${url.pathname}${url.search}`;
}

/** `linkHintsOf` (contract `LinkHintsOf`). */
export function linkHintsOf(nodes: JsxNode[], deployment: { origins: readonly string[] }): LinkHints {
  const origins = new Set(deployment.origins.flatMap((o) => originOf(o) ?? []));
  const seen = new Set<string>();
  const prefetch: string[] = [];
  const walk = (list: readonly JsxNode[]) => {
    for (const node of list) {
      if (node.type !== 'element') continue;
      if (!node.isComponent && node.tag === 'a' && !node.attributes.some((a) => a.name === 'download')) {
        const value = node.attributes.find((a) => a.name === 'href')?.value;
        const hint = value?.static && typeof value.json === 'string' ? hintFor(value.json, origins) : null;
        if (hint !== null && !seen.has(hint)) {
          seen.add(hint);
          prefetch.push(hint);
        }
      }
      // A <For> template is one subtree in the AST, so its links are visited once, not per row.
      walk(node.children);
    }
  };
  walk(nodes);
  return { prefetch, prerender: prefetch.slice(0, PRERENDER_LIMIT) };
}
