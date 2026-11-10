/**
 * Example backend functions: open deals from a private Google Sheet shared with a service account.
 * Secrets: GOOGLE_SA = that service account's JSON key, set by the page owner in the page's
 *   Resolvers panel. The host signs in with it and sends the token only to sheets.googleapis.com.
 * Usage: cp resolvers/resolver-google-sheets.ts pipeline.ts; link it with
 *   <link rel="af-resolver" data-af-name="pipeline" href="./pipeline.ts">; the page calls
 *   fetch('/fn/deals?stage=Open'); publish, then send the owner to the Resolvers panel to set
 *   GOOGLE_SA and press Test connection (it runs test).
 * Next: set SHEET (the ID in the sheet's URL) and RANGE; rename the fields to your header row.
 * Gotchas: share the sheet with the service account's email (Viewer). For a sheet anyone with the
 *   link can view, use an API key instead: secrets={SHEETS_KEY:'sheets.googleapis.com'}, drop auth
 *   and add &key={{SHEETS_KEY}} to the URL.
 */
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const RANGE = 'Pipeline!A1:E500';
export const secrets = { GOOGLE_SA: 'sheets.googleapis.com' };
export const roles = { test: 'owner' };
type Auth = { type: 'google'; secret: string; scopes: string[] };
type Res = { ok: boolean; status: number; json(): Promise<unknown> };
type Caps = { fetch(url: string, init?: { auth?: Auth }): Promise<Res> };
const auth: Auth = { type: 'google', secret: 'GOOGLE_SA',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] };

async function rows(caps: Caps): Promise<Array<Record<string, string | null>>> {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET + '/values/' +
    encodeURIComponent(RANGE) + '?valueRenderOption=UNFORMATTED_VALUE';
  const res = await caps.fetch(url, { auth });
  if (!res.ok) throw Error('Google Sheets answered ' + res.status);
  const [header = [], ...values] = ((await res.json()) as { values?: string[][] }).values ?? [];
  return values.map(row => Object.fromEntries(header.map((key, i) => [key, row[i] ?? null])));
}

export default {
  async deals({ stage }: { stage?: string }, _principal: unknown, caps: Caps) {
    return (await rows(caps))
      .filter(r => r.Stage !== 'Closed' && (!stage || r.Stage === stage))
      .map(r => ({ name: String(r.Name ?? ''), stage: String(r.Stage ?? ''), owner: r.Owner,
        amount: Number(r.Amount) || null }));
  },
  async test(_input: unknown, _principal: unknown, caps: Caps) {
    return 'Read ' + (await rows(caps)).length + ' rows from ' + RANGE;
  },
};
