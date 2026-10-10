/**
 * THE ROWS DIGEST, browser side: the first 16 hex characters of the SHA-256 of `JSON.stringify(rows)`
 * — the same value lib/publish/prepared/charts.server `rowsDigest` stores as `DrawnChart.rows`, so an
 * island can tell whether the chart the server drew is still the chart of the rows it now holds.
 * SubtleCrypto, so it is async; framework-free.
 */
export async function rowsDigest(rows: readonly Record<string, unknown>[]): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  let hex = '';
  for (const byte of new Uint8Array(bytes, 0, 8)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
