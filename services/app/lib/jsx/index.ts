/**
 * Static-JSX-as-data engine — parse → static-validate → serialize, shared by the server's
 * validate-on-save and every editing path that works on the parsed AST. Defining "what `jsx`
 * means" once keeps save-validation and the agent's markup surface from drifting.
 *
 * It also owns the vocabulary that validation checks against (component and tag names, the
 * Mermaid source rules, the `<DeckGL>` map spec and its boundary ids, the `$_row` grammar), so
 * this module is a leaf: it imports only itself, `@artifactbin/contracts` and `@artifactbin/utils`.
 */
import { syntaxErrorDetail } from './syntax-error';
import { parseJsx } from './parse';
import { validateJsx } from './validate';
import type { ValidationError } from './types';

export * from './types';
export { parseJsx } from './parse';
export { repairJsxSource } from './repair';
export { serializeJsx } from './serialize';
// Node-level validation for callers that split the tree before validating
// (lib/story/document/helmet.ts excludes the Helmet subtree while keeping exact spans).
export { validateJsx } from './validate';

// The vocabulary validation checks against. Every module here is pure and browser-safe, so the
// barrel stays loadable in the reader; a node-only leaf never belongs in it.
export { STORY_UI_COMPONENT_NAME_LIST, STORY_HTML_TAGS, STORY_SVG_TAGS } from './component-names';
export { STORY_COMPONENT_NAMES } from './story-components';
export { mermaidSourceError, mermaidDiagramKind, mermaidImageKey } from './mermaid-source';
export { validateDeckMap } from './deck-spec';
export { BOUNDARY_IDS, isBoundary } from './boundary-ids';
export { parseRowRef, substituteRow, analyzeRowScopes } from './row-scope';

/**
 * Parse → validate a `jsx` source against the static-JSX security rules (registered
 * components only, no <script>/event-handlers/dangerous URLs). Returns [] when valid.
 */
export function validateJsxSource(
  source: string,
  components: Iterable<string>,
  allowedHtmlTags?: Iterable<string>,
  stylePolicy?: 'allow' | 'no-inline-style',
): ValidationError[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return [syntaxErrorDetail(source, parsed)];
  return validateJsx(parsed.nodes, { components, allowedHtmlTags, stylePolicy });
}
