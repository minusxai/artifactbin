/**
 * Which language a code block is highlighted as, without Prism: the fence's name, normalized through the aliases of
 * the grammars ./prism-grammars.ts bundles (a test pins that each has its grammar), and only up to the highlighting
 * length cap. ./code-block.ts highlights with it, and the editor marks a block's language before Prism has loaded.
 */
export const MAX_HIGHLIGHT_CODE_LENGTH = 100_000;

const aliases = new Map<string, string>([
  ['html', 'html'], ['htm', 'html'], ['xml', 'html'],
  ['md', 'markdown'], ['markdown', 'markdown'], ['mdx', 'markdown'],
  ['js', 'javascript'], ['javascript', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'],
  ['ts', 'typescript'], ['typescript', 'typescript'], ['mts', 'typescript'], ['cts', 'typescript'],
  ['css', 'css'], ['jsx', 'jsx'], ['tsx', 'tsx'],
]);
/** Every canonical language, for the test that each has a bundled grammar. */
export const CODE_LANGUAGES: readonly string[] = [...new Set(aliases.values())];

export function normalizeLanguage(language?: string | null): string | null {
  if (!language || language.length > 64) return null;
  const name = language.trim().toLowerCase().replace(/^\./, '').split(/[\s,{]/, 1)[0];
  return aliases.get(name) ?? null;
}

/** The language renderCodeBlock marks `source` with (`class="language-<x>"`), without tokenizing it; null for plain text. */
export function codeBlockLanguage(source: string, language?: string | null): string | null {
  const canonical = normalizeLanguage(language);
  return canonical && source.length <= MAX_HIGHLIGHT_CODE_LENGTH ? canonical : null;
}
