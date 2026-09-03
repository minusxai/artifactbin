// Measures when the in-document reader chrome starts responding to scroll,
// relative to navigation start, on a chart-heavy public document at a phone
// viewport with throttled CPU + network. Also logs when the runtime entry and
// the anchor entry modules finished loading (resource timing).
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://artifactbin.dev/a/WiwhwI';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });

const t0 = Date.now();
await page.goto(url, { waitUntil: 'commit' });
let firstHide = null, firstBusy = null, busyGone = null, chromeSeen = null;
for (let i = 0; i < 300 && firstHide === null; i++) {
  const r = await page.evaluate(() => {
    const chrome = document.querySelector('.mx-reader-chrome');
    window.scrollBy(0, 300);
    return {
      chrome: !!chrome,
      hidden: !!chrome?.classList.contains('mx-reader-chrome--hidden'),
      busy: document.querySelectorAll('.mx-busy').length,
      hydrated: !!document.querySelector('[data-mx-hydrated], .mx-embed svg, canvas'),
      y: window.scrollY,
    };
  }).catch(() => null);
  const t = Date.now() - t0;
  if (r) {
    if (r.chrome && chromeSeen === null) chromeSeen = t;
    if (r.busy > 0 && firstBusy === null) firstBusy = t;
    if (firstBusy !== null && r.busy === 0 && busyGone === null) busyGone = t;
    if (r.hidden && firstHide === null) firstHide = t;
  }
  await page.waitForTimeout(100);
}
const timings = await page.evaluate(() => performance.getEntriesByType('resource')
  .filter((e) => /\/story\//.test(e.name))
  .map((e) => ({ name: e.name.replace(/.*\/story\//, ''), start: Math.round(e.startTime), end: Math.round(e.responseEnd) })));
console.log(JSON.stringify({ url, chromeSeen, firstBusy, busyGone, firstHide, timings }, null, 1));
await browser.close();
