import { IngestError } from './types';

/**
 * A public Google Sheet is readable as CSV with no auth at all — verified:
 * `…/export?format=csv&gid=0` answers `200 text/csv` with no credentials.
 * That is the whole integration; there is no OAuth here by design.
 */
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
const FETCH_TIMEOUT_MS = 10_000;

/** The CSV export URL for a Sheets link, or null if it is not one. */
export function sheetCsvUrl(url: string): string | null {
  const id = SHEET_URL.exec(url.trim())?.[1];
  if (!id) return null;
  // The gid selects the TAB. Losing it silently returns a different sheet's
  // data, which is worse than failing, so it is carried from either the
  // fragment (#gid=7, how the browser writes it) or the query.
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1] ?? '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/**
 * Fetch a public sheet as CSV.
 *
 * Only ever fetches docs.google.com — the URL comes from a user, and following
 * an arbitrary one would make this endpoint a request proxy.
 */
export async function fetchSheetCsv(url: string): Promise<string> {
  const exportUrl = sheetCsvUrl(url);
  if (!exportUrl) throw new IngestError('not_a_sheet_url', 'Not a Google Sheets link.');

  let res: Response;
  try {
    res = await fetch(exportUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  } catch (error) {
    throw new IngestError('fetch_failed', `Could not reach Google Sheets: ${(error as Error).message}`);
  }

  // The content-type check is the load-bearing guard. A sheet that is not
  // shared answers 404 with text/html, and a private one can answer 200 with a
  // sign-in page; both would otherwise be stored verbatim as a "dataset".
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('text/csv')) {
    throw new IngestError('sheet_not_public', 'That sheet is not publicly readable. Share it as "anyone with the link can view".');
  }
  return res.text();
}
