/** Query the real protected UI without removing its shadow boundary in tests. */
import { getQueriesForElement, waitFor, type screen as Screen } from '@testing-library/dom';
const roots = () => [document.body, ...Array.from(document.querySelectorAll('[data-trusted-ui]')).flatMap(host => host.shadowRoot ? [host.shadowRoot] : [])];
export const trustedText = () => roots().map(root => root.textContent ?? '').join('\n');
export const trustedQuery = (selector: string): HTMLElement | null => {
  for (const root of roots()) { const found = root.querySelector<HTMLElement>(selector); if (found) return found; }
  return null;
};
export const screen = new Proxy({} as typeof Screen, { get(_target, key) {
  const method = String(key);
  const match = /^(get|query|find)(All)?By(.+)$/.exec(method);
  if (!match) throw new Error(`Unsupported trusted screen query: ${method}`);
  return (...args: unknown[]) => {
    const query = `queryAllBy${match[3]}`;
    const all = () => roots().flatMap(root => {
      const queries = getQueriesForElement(root as HTMLElement) as unknown as Record<string, (...values: unknown[]) => HTMLElement[]>;
      return queries[query]!(...args);
    });
    const get = () => { const result = all(); if (match[2] && result.length) return result; if (!match[2] && result.length === 1) return result[0]; throw new Error(`${method}: expected ${match[2] ? 'at least one' : 'one'} match; found ${result.length}. ${JSON.stringify(args)}\n${trustedText().slice(-2500)}`); };
    if (match[1] === 'find') return waitFor(get);
    if (match[1] === 'get') return get();
    const result = all(); if (match[2]) return result; if (result.length > 1) throw new Error(`${method}: multiple matches`); return result[0] ?? null;
  };
} });
