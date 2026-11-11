/** Semantic saved native region facts, independent of allocated block/inline identities. */
import { JSDOM } from 'jsdom';
export const NATIVE_TASK_CHECKBOX = 'li[data-checked] input[type="checkbox"]';
export function nativeRegionFacts(html) {
  const fragment = JSDOM.fragment(html);
  const root = fragment.querySelector('[data-af-id="notes"]') ?? fragment;
  return { text: root.textContent, strong: [...root.querySelectorAll('strong')].map(node => node.textContent) };
}
