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

/** The language renderCodeBlock marks `source` with (`class="language-<x>"`), without tokenizing it; null for plain text. */
export function codeBlockLanguage(source: string, language?: string | null): string | null {
  const canonical = normalizeLanguage(language);
  return canonical && source.length <= MAX_HIGHLIGHT_CODE_LENGTH && Prism.languages[canonical] ? canonical : null;
}

interface Highlighted { language: string; tokens: (string | PrismToken)[] }
/** The canonical language and the grammar's tokens, or null when the code is written as plain text. */
function highlighted(source: string, language?: string | null): Highlighted | null {
  const canonical = normalizeLanguage(language);
  if (!canonical || source.length > MAX_HIGHLIGHT_CODE_LENGTH) return null;
  try {
    const grammar = Prism.languages[canonical] as PrismGrammar | undefined;
    return grammar ? { language: canonical, tokens: Prism.tokenize(source, grammar) as (string | PrismToken)[] } : null;
  } catch {
    return null;
  }
}

/** Render code as inert escaped text using only the explicitly bundled Prism grammars. */
export function renderCodeBlock(source: string, language?: string | null): string {
  const code = highlighted(source, language);
  if (!code) return `<pre><code>${escapeHtml(source)}</code></pre>`;
  return `<pre><code class="language-${code.language}" data-language="${code.language}">${renderTokens(code.tokens)}</code></pre>`;
}

export interface CodeHighlight {
  /** The canonical language renderCodeBlock writes as `class="language-<x>" data-language="<x>"`. */
  language: string;
  /** The source cut where any token starts or ends: each run with its token classes, outermost first. */
  ranges: Array<{ from: number; to: number; classNames: string[] }>;
}
/** renderCodeBlock's highlighting as source ranges (what an editor decorates), or null when it writes plain text. */
export function codeHighlight(source: string, language?: string | null): CodeHighlight | null {
  const code = highlighted(source, language);
  if (!code) return null;
  const ranges: CodeHighlight['ranges'] = [];
  let offset = 0;
  const walk = (tokens: readonly (string | PrismToken)[], classNames: string[]) => {
    for (const token of tokens) {
      const content = typeof token === 'string' ? token : token.content;
      const className = typeof token === 'string' ? undefined : tokenClasses.get(token.type);
      const inner = className ? [...classNames, className] : classNames;
      if (typeof content !== 'string') { walk(content, inner); continue; }
      if (inner.length && content.length) ranges.push({ from: offset, to: offset + content.length, classNames: inner });
      offset += content.length;
    }
  };
  walk(code.tokens, []);
  return { language: code.language, ranges };
}
