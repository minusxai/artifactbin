/**
 * The render guards and the Playwright capture, over the served document at
 * `/a/<id>/raw?chrome=0` (the document itself, top-level, no app chrome).
 * Idioms from the gates: console errors, failed subresource responses, the
 * layout fitting the viewport at phone width, drawn chart marks.
 */
import type { Browser, Page } from 'playwright';

export interface DocumentInspection {
  consoleErrors: string[];
  failedResponses: string[];
  scrollWidth: number;
  innerWidth: number;
  fits: boolean;
  h1: string | null;
  marks: number;
}

const SETTLE_MS = 1_500;

async function open(browser: Browser, url: string, width: number): Promise<{ page: Page; consoleErrors: string[]; failedResponses: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('response', (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  await page.waitForTimeout(SETTLE_MS);
  return { page, consoleErrors, failedResponses };
}

export async function inspectDocument(browser: Browser, url: string, width: number): Promise<DocumentInspection> {
  const { page, consoleErrors, failedResponses } = await open(browser, url, width);
  try {
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
      marks: document.querySelectorAll('svg [class*="mark-"] path, svg [class*="mark-"] rect, canvas').length,
    }));
    return { consoleErrors, failedResponses, ...m, fits: m.scrollWidth <= m.innerWidth };
  } finally {
    await page.close();
  }
}

/** Full-page PNG of the served document at `width`. */
export async function screenshotDocument(browser: Browser, url: string, width: number, outPath: string): Promise<void> {
  const { page } = await open(browser, url, width);
  try {
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await page.close();
  }
}

/** The product's own capture: `/a/<id>/export?format=png`. Null when the product could not render. */
export async function exportDocument(serverUrl: string, id: string): Promise<Buffer | null> {
  const res = await fetch(`${serverUrl}/a/${id}/export?format=png`);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
