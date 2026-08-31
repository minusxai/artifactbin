/**
 * Static-JSX-as-data engine (File Architecture v2) — parse → static-validate → serialize,
 * shared by server (validate-on-save) and the content⇄jsx converter. Defining "what `jsx`
 * means" once keeps save-validation and the agent's markup surface from drifting.
 */
import { syntaxErrorDetail } from './syntax-error';
import { parseJsx } from './parse';
import { validateJsx } from './validate';
import type { ValidationError } from './types';

export * from './types';
export { parseJsx } from './parse';
export { serializeJsx } from './serialize';
// Node-level validation for callers that split the tree before validating
// (lib/story/helmet.ts excludes the Helmet subtree while keeping exact spans).
export { validateJsx } from './validate';

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
