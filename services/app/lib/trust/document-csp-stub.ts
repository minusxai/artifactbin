/**
 * TODO(brief A): delete this stub once `lib/story/styles/document-csp.ts` lands. It stands in for A's
 * `buildDocumentCsp({ self, extensions })` with that exact signature, and holds `appendCspExtensions`,
 * which the served document uses until A's builder replaces `markupCsp` there: the reader's trusted
 * extensions (lib/trust/document-trust cspExtensionsFor) appended to the policy it already serves.
 */
import { CSP_DIRECTIVES, EMPTY_CSP_EXTENSIONS, type CspDirective, type CspExtensions } from '@/lib/story/document/csp-extensions';

/** The policy directives each declared set extends. Fonts ride on `csp-style`: a stylesheet host serves its faces. */
const DIRECTIVE_NAMES: Record<CspDirective, readonly string[]> = {
  connect: ['connect-src'], script: ['script-src'], style: ['style-src', 'font-src'], img: ['img-src'], frame: ['frame-src'], media: ['media-src'],
};

/**
 * Append each directive's origins to that directive in `policy`. Identity on an empty set. A directive
 * the policy does not carry is left alone: adding it would narrow its `default-src` fallback, never widen.
 */
export function appendCspExtensions(policy: string, extensions: CspExtensions = EMPTY_CSP_EXTENSIONS): string {
  if (CSP_DIRECTIVES.every((d) => extensions[d].length === 0)) return policy;
  return policy.split(/;\s*/).map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    const kinds = CSP_DIRECTIVES.filter((d) => DIRECTIVE_NAMES[d].includes(name ?? ''));
    if (!kinds.length) return directive;
    const added = [...new Set(kinds.flatMap((kind) => extensions[kind]))].filter((origin) => !sources.includes(origin));
    if (!added.length) return directive;
    // 'none' cannot stand beside a source: the declared origins replace it.
    return sources.length === 1 && sources[0] === "'none'" ? `${name} ${added.join(' ')}` : `${directive} ${added.join(' ')}`;
  }).join('; ');
}

/** Brief A's default document-origin policy, as its brief states it; the stub's only consumer is its test. */
export function buildDocumentCsp({ self, extensions = EMPTY_CSP_EXTENSIONS }: { self: string; extensions?: CspExtensions }): string {
  const origin = self.replace(/\/+$/, '');
  const cdns = 'https://esm.sh https://cdn.jsdelivr.net https://unpkg.com';
  return appendCspExtensions([
    "default-src 'none'",
    `script-src 'self' blob: 'wasm-unsafe-eval' ${cdns}`,
    `connect-src ${origin} ${cdns}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    'img-src https: data: blob:',
    "media-src 'self' https: blob:",
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join('; '), extensions);
}
