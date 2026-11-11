/** Semantic saved native region facts, independent of allocated block/inline identities. */
import { JSDOM } from 'jsdom';
export const NATIVE_TASK_CHECKBOX = 'li[data-checked] input[type="checkbox"]';
export function nativeRegionFacts(html) {
  const root = JSDOM.fragment(html).querySelector('[data-af-id="notes"]');
  if (!root) throw new Error('Missing native notes region');
  return { text: root.textContent, strong: [...root.querySelectorAll('strong')].map(node => node.textContent) };
}
