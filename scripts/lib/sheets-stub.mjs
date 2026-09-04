/**
 * THE GATE'S GOOGLE SHEET, SERVED LOCALLY — same URL, no third party.
 *
 * `scripts/gate-data-ingest.mjs` imports Google's own public sample sheet to
 * prove the whole stack: a Sheets link becomes an export URL, the CSV is
 * fetched, columns are inferred, rows are stored and a chart draws from them.
 * That is worth testing. What is NOT worth testing on every pull request is
 * whether Google will serve a GitHub runner today — and on 2026-09-04 it would
 * not, twice, including the retry-alone (run 33874008704). A merge gate went
 * red for a sheet that was perfectly fine.
 *
 * So the URL stays exactly as an author would write it and the ANSWER is
 * local. The gate is unchanged; only what the server gets back is.
 *
 * Scope, deliberately narrow — this is a gate fixture, never a way to avoid
 * the network:
 *  - It matches `docs.google.com/spreadsheets/` and nothing else; every other
 *    request the gates make still goes out for real.
 *  - It patches `globalThis.fetch`, which is what `lib/data-ingest/sheets.ts`
 *    calls. `lib/web-ingest/fetch.ts` uses `node:https` with its own DNS
 *    lookup, so the SSRF-guarded door is untouched by construction and cannot
 *    be stubbed by accident here.
 *  - It is loaded with `--import` by `scripts/gates.mjs` for the throwaway
 *    servers IT boots, and by nothing else. It is not in the image, not in the
 *    bundle, and not on any production path.
 *
 * What this gives up, honestly: the gate no longer proves Google's live
 * contract (that the export endpoint still answers `text/csv`). The URL
 * shaping is pinned by lib/data-ingest/__tests__/ingest.test.ts, so the
 * exposure is a change at Google's end — a scheduled canary against the real
 * sheet is the place for that, never a check that can block a merge.
 */

/** Google's public sample spreadsheet — the id `gate-data-ingest.mjs` imports. */
const PUBLIC_SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

/** What that sheet actually returns, trimmed to what the gate asserts on. */
const SAMPLE_CSV = [
  'Student Name,Gender,Class Level,Home State,Major',
  'Alexandra,Female,4. Senior,CA,English',
  'Andrew,Male,1. Freshman,SD,Math',
  'Anna,Female,1. Freshman,NC,English',
].join('\n') + '\n';

const realFetch = globalThis.fetch;

globalThis.fetch = async function sheetsStubFetch(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (!url.includes('docs.google.com/spreadsheets/')) return realFetch(input, init);
  // Any OTHER sheet id is the gate's "not shared" case, and Google answers that
  // with an HTML page — which is exactly what the content-type guard exists to
  // refuse, so the refusal is now deterministic too rather than borrowed from
  // Google's 404.
  const isPublic = url.includes(PUBLIC_SHEET_ID);
  return new Response(isPublic ? SAMPLE_CSV : '<!DOCTYPE html><html><body>Sign in</body></html>', {
    status: isPublic ? 200 : 404,
    headers: { 'content-type': isPublic ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8' },
  });
};
