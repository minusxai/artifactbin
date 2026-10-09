import { parser as cssParser } from '@lezer/css';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { configureNesting, parser as htmlParser } from '@lezer/html';
import { parser as markdownParser } from '@lezer/markdown';
import { parser as javascriptParser } from '@lezer/javascript';
import { escapeHtml } from '@artifactbin/utils/escape';

/** Keep parsing synchronous and predictable for saved-document SSR. */
export const MAX_HIGHLIGHT_CODE_LENGTH = 100_000;

const aliases: Readonly<Record<string, string>> = {
  html: 'html', htm: 'html', xml: 'html',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', typescript: 'typescript', mts: 'typescript', cts: 'typescript',
  css: 'css',
  jsx: 'jsx', tsx: 'tsx',
};

const tokenHighlighter = tagHighlighter([
  { tag: tags.keyword, class: 'mx-code-token-keyword' },
  { tag: tags.controlKeyword, class: 'mx-code-token-keyword' },
  { tag: tags.definitionKeyword, class: 'mx-code-token-keyword' },
  { tag: tags.moduleKeyword, class: 'mx-code-token-keyword' },
  { tag: tags.operatorKeyword, class: 'mx-code-token-keyword' },
  { tag: tags.typeOperator, class: 'mx-code-token-keyword' },
  { tag: tags.string, class: 'mx-code-token-string' },
  { tag: tags.docString, class: 'mx-code-token-string' },
  { tag: tags.character, class: 'mx-code-token-string' },
  { tag: tags.attributeValue, class: 'mx-code-token-string' },
  { tag: tags.comment, class: 'mx-code-token-comment' },
  { tag: tags.lineComment, class: 'mx-code-token-comment' },
  { tag: tags.blockComment, class: 'mx-code-token-comment' },
  { tag: tags.docComment, class: 'mx-code-token-comment' },
  { tag: tags.number, class: 'mx-code-token-number' },
  { tag: tags.integer, class: 'mx-code-token-number' },
  { tag: tags.float, class: 'mx-code-token-number' },
  { tag: tags.bool, class: 'mx-code-token-literal' },
  { tag: tags.null, class: 'mx-code-token-literal' },
  { tag: tags.atom, class: 'mx-code-token-literal' },
  { tag: tags.regexp, class: 'mx-code-token-regexp' },
  { tag: tags.typeName, class: 'mx-code-token-type' },
  { tag: tags.className, class: 'mx-code-token-type' },
  { tag: tags.definition(tags.variableName), class: 'mx-code-token-definition' },
  { tag: tags.function(tags.variableName), class: 'mx-code-token-function' },
  { tag: tags.propertyName, class: 'mx-code-token-property' },
  { tag: tags.attributeName, class: 'mx-code-token-property' },
  { tag: tags.tagName, class: 'mx-code-token-tag' },
  { tag: tags.heading, class: 'mx-code-token-heading' },
  { tag: tags.link, class: 'mx-code-token-link' },
  { tag: tags.url, class: 'mx-code-token-link' },
  { tag: tags.emphasis, class: 'mx-code-token-emphasis' },
  { tag: tags.strong, class: 'mx-code-token-strong' },
  { tag: tags.operator, class: 'mx-code-token-operator' },
  { tag: tags.punctuation, class: 'mx-code-token-punctuation' },
  { tag: tags.separator, class: 'mx-code-token-punctuation' },
  { tag: tags.bracket, class: 'mx-code-token-punctuation' },
  { tag: tags.meta, class: 'mx-code-token-meta' },
  { tag: tags.processingInstruction, class: 'mx-code-token-meta' },
]);

function normalizeLanguage(language?: string | null): string | null {
  if (!language || language.length > 64) return null;
  const name = language.trim().toLowerCase().replace(/^\./, '').split(/[\s,{]/, 1)[0];
  return aliases[name] ?? null;
}

function parserFor(language: string) {
  switch (language) {
    case 'javascript': return javascriptParser;
    case 'typescript': return javascriptParser.configure({ dialect: 'ts' });
    case 'jsx': return javascriptParser.configure({ dialect: 'jsx' });
    case 'tsx': return javascriptParser.configure({ dialect: 'ts jsx' });
    case 'html': return htmlParser.configure({ wrap: configureNesting([
      { tag: 'script', parser: javascriptParser },
      { tag: 'style', parser: cssParser },
    ]) });
    case 'css': return cssParser;
    case 'markdown': return markdownParser;
    default: return null;
  }
}

/**
 * Render code as inert escaped text. Lezer supplies bounded language grammars;
 * only generated, namespaced token classes are added to the output.
 */
export function renderCodeBlock(source: string, language?: string | null): string {
  const canonical = normalizeLanguage(language);
  if (!canonical || source.length > MAX_HIGHLIGHT_CODE_LENGTH) {
    return `<pre><code>${escapeHtml(source)}</code></pre>`;
  }

  try {
    const parser = parserFor(canonical);
    if (!parser) return `<pre><code>${escapeHtml(source)}</code></pre>`;
    const tree = parser.parse(source);
    const pieces: string[] = [];
    let cursor = 0;
    highlightTree(tree, tokenHighlighter, (from, to, classes) => {
      if (from < cursor || to > source.length || from >= to) return;
      pieces.push(escapeHtml(source.slice(cursor, from)));
      pieces.push(`<span class="${classes}">${escapeHtml(source.slice(from, to))}</span>`);
      cursor = to;
    });
    pieces.push(escapeHtml(source.slice(cursor)));
    return `<pre><code class="language-${canonical}" data-language="${canonical}">${pieces.join('')}</code></pre>`;
  } catch {
    return `<pre><code>${escapeHtml(source)}</code></pre>`;
  }
}
