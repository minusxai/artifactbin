/**
 * What Chromium actually sends on the home page's create fetch (MEASURED on production). Any test that
 * posts `/api/start` through the composed proxy needs these: that route is `browser_only` in every policy
 * file, and the proxy refuses it to anything that is not the page. Kept here rather than typed into each
 * file, so the measured shape has a single home.
 */
export const PAGE_HEADERS: Readonly<Record<string, string>> = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };
