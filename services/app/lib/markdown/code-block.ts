import Prism from './prism-grammars';
import { escapeHtml } from '@artifactbin/utils/escape';

/** Keep parsing synchronous and predictable for saved-document SSR. */
export const MAX_HIGHLIGHT_CODE_LENGTH = 100_000;

const aliases = new Map<string, string>([
  ['html', 'html'], ['htm', 'html'], ['xml', 'html'],
  ['md', 'markdown'], ['markdown', 'markdown'], ['mdx', 'markdown'],
  ['js', 'javascript'], ['javascript', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'],
  ['ts', 'typescript'], ['typescript', 'typescript'], ['mts', 'typescript'], ['cts', 'typescript'],
  ['css', 'css'], ['jsx', 'jsx'], ['tsx', 'tsx'],
]);

const tokenClasses = new Map<string, string>([
  ['keyword', 'mx-code-token-keyword'], ['boolean', 'mx-code-token-literal'], ['constant', 'mx-code-token-type'],
  ['string', 'mx-code-token-string'], ['char', 'mx-code-token-string'], ['comment', 'mx-code-token-comment'],
  ['number', 'mx-code-token-number'], ['function', 'mx-code-token-function'], ['class-name', 'mx-code-token-type'],
  ['tag', 'mx-code-token-tag'], ['attr-name', 'mx-code-token-property'], ['attr-value', 'mx-code-token-string'],
  ['property', 'mx-code-token-property'], ['selector', 'mx-code-token-type'], ['operator', 'mx-code-token-operator'],
  ['punctuation', 'mx-code-token-punctuation'], ['title', 'mx-code-token-heading'], ['bold', 'mx-code-token-strong'],
  ['italic', 'mx-code-token-emphasis'], ['url', 'mx-code-token-link'], ['code-snippet', 'mx-code-token-string'],
  ['entity', 'mx-code-token-meta'], ['doctype', 'mx-code-token-meta'], ['prolog', 'mx-code-token-meta'], ['cdata', 'mx-code-token-meta'],
  ['attr-equals', 'mx-code-token-punctuation'], ['important', 'mx-code-token-keyword'],
]);

type PrismToken = { type: string; content: string | readonly (string | PrismToken)[]; alias?: string | readonly string[] };
type PrismGrammar = Record<string, unknown>;

function normalizeLanguage(language?: string | null): string | null {
  if (!language || language.length > 64) return null;
  const name = language.trim().toLowerCase().replace(/^\./, '').split(/[\s,{]/, 1)[0];
  return aliases.get(name) ?? null;
}

function renderTokens(tokens: readonly (string | PrismToken)[]): string {
  return tokens.map(token => {
    if (typeof token === 'string') return escapeHtml(token);
    const children = typeof token.content === 'string' ? escapeHtml(token.content) : renderTokens(token.content);
    const className = tokenClasses.get(token.type);
    return className ? `<span class="${className}">${children}</span>` : children;
  }).join('');
}

/** Render code as inert escaped text using only the explicitly bundled Prism grammars. */
export function renderCodeBlock(source: string, language?: string | null): string {
  const canonical = normalizeLanguage(language);
  if (!canonical || source.length > MAX_HIGHLIGHT_CODE_LENGTH) {
    return `<pre><code>${escapeHtml(source)}</code></pre>`;
  }

  try {
    const grammarName = canonical === 'html' ? 'html' : canonical;
    const grammar = Prism.languages[grammarName] as PrismGrammar | undefined;
    if (!grammar) return `<pre><code>${escapeHtml(source)}</code></pre>`;
    const tokens = Prism.tokenize(source, grammar) as (string | PrismToken)[];
    return `<pre><code class="language-${canonical}" data-language="${canonical}">${renderTokens(tokens)}</code></pre>`;
  } catch {
    return `<pre><code>${escapeHtml(source)}</code></pre>`;
  }
}
