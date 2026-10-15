/** Apart from lib/jsx/template so the data kit, which only names a spec, never carries the template grammar. */
/**
 * A short, stable digest of a resolved chart spec (FNV-1a, 64 bits as hex): what a served drawing records as
 * the spec it drew, so a reader whose values resolve the spec differently never keeps it. Synchronous, so the
 * server render, the snapshot and the browser compute it alike.
 */
export function specDigest(value: unknown): string {
  const s = JSON.stringify(value ?? null);
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
