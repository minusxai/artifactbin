/**
 * WHAT AN EXPORT TAKES FROM A READY PAGE (./render-lane `ReadyPage`): `captureOf(req)` is how a render request is
 * photographed (the density its page is drawn at, and `take`: the full surface, a preview, a card, one slide or one
 * element, exact to the requested size), and `harvestDrawings(req, ready)` the SVG drawings a page holds, as text.
 * A deck without the asked slide throws `NoSlideError`; an element that cannot be shot throws `NoElementError`.
 */
import sharp from 'sharp';
import type { HarvestedSvg, RenderRequest, SvgHarvestRequest } from '@artifactbin/contracts/browser';
import { ELEMENT_CAPTURE, SVG_HARVEST_LIMITS, type NoElement } from '@artifactbin/contracts/browser';
import type { Locator } from 'playwright';
import type { ReadyPage } from './render-lane';

// The editor can display the overview at ~850 CSS px on a 2x screen. Keeping
// canonical horizontal resolution avoids enlarging a thumbnail while the
// height cap still bounds unusually tall documents.
const PREVIEW_WIDTH = 1_600;
const PREVIEW_MAX_HEIGHT = 4_096;
// The one slide drawn, whatever the deck's own CSS shows: the same rule as toolbox-check-capture.mjs's.
const SLIDE_REVEAL_CSS = '[data-af-slide]{transition:none!important;animation:none!important}'
  + '[data-af-slide]:not([data-af-slide-shot]){visibility:hidden!important;opacity:0!important}'
  + '[data-af-slide-shot]{visibility:visible!important;opacity:1!important}';
export class NoSlideError extends Error { constructor(readonly slides: number) { super(`document has ${slides} slides`); } }
export class NoElementError extends Error { constructor(readonly verdict: NoElement) { super(`element ${verdict.why}`); } }
/** Generated deck chrome stays out of a slide's or an element's picture: hidden, with nothing animating. */
const DECK_CHROME_HIDDEN = '[data-af-deck-chrome],[data-af-deck-chrome] *,[data-af-deck-chrome]::before,[data-af-deck-chrome]::after,[data-af-deck-chrome] *::before,[data-af-deck-chrome] *::after{visibility:hidden!important;transition:none!important;animation:none!important}';
/** The mark an element capture puts on its match, so the shot is taken by this name and never by the author's selector. */
const ELEMENT_SHOT = 'data-af-element-shot';

/**
 * Serialized into Chromium: the first element under `root` that the author's selector matches, through the document's
 * own `querySelector` (the selector is an argument, never code, and no Playwright engine reads it), marked to be shot.
 * Answers why not when there is no match, a match with no size or not visible, a selector that is not CSS, or a match
 * larger than the capture allows. Self-contained and synchronous.
 */
type Marked = { why: 'none' | 'hidden' | 'invalid' } | { why: 'too_large'; width: number; height: number } | { why?: never; width: number; height: number };
function markElement(root: Element, input: { selector: string; mark: string; max: number }): Marked {
  let found: Element | null;
  try { found = root.querySelector(input.selector); } catch { return { why: 'invalid' }; }
  if (!found) return { why: 'none' };
  const box = found.getBoundingClientRect();
  if (box.width < 1 || box.height < 1 || !found.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return { why: 'hidden' };
  const width = Math.ceil(box.width), height = Math.ceil(box.height);
  if (width > input.max || height > input.max) return { why: 'too_large', width, height };
  found.setAttribute(input.mark, '');
  return { width, height };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Serialized into Chromium: every `collect` element under the surface whose
 * `<img>` holds an SVG `data:` URL — its own `data-*` attributes, the image's
 * width/height attributes and the URL. Self-contained, synchronous, and with
 * no nested function: a bundler's name-keeping helper would not exist there.
 */
function collectDrawings(input: { selector: string; collect: string; limit: number }) {
  const root = document.querySelector(input.selector);
  if (!root) return [];
  const out: Array<{ attributes: Record<string, string>; width: number | null; height: number | null; src: string }> = [];
  for (const element of root.querySelectorAll(input.collect)) {
    const img = element.querySelector('img');
    const src = img?.getAttribute('src') ?? '';
    if (!img || !src.startsWith('data:image/svg+xml')) continue;
    const attributes: Record<string, string> = {};
    for (const attribute of element.attributes) if (attribute.name.startsWith('data-')) attributes[attribute.name] = attribute.value.slice(0, 512);
    const width = Number(img.getAttribute('width')), height = Number(img.getAttribute('height'));
    out.push({ attributes, width: img.hasAttribute('width') && Number.isFinite(width) ? width : null, height: img.hasAttribute('height') && Number.isFinite(height) ? height : null, src });
    if (out.length >= input.limit) break;
  }
  return out;
}

/** The SVG text of an `image/svg+xml` data URL (percent-encoded or base64). */
function svgFromDataUrl(src: string): string {
  const comma = src.indexOf(',');
  const head = src.slice(0, comma);
  if (comma < 0 || !/^data:image\/svg\+xml(;charset=utf-8)?(;base64)?$/i.test(head)) throw new Error('Not an SVG data URL');
  const body = src.slice(comma + 1);
  return head.toLowerCase().endsWith(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
}

type Shot = { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array };
/** How `req` is photographed: the device scale its page is drawn at, and the photograph of that page once ready. */
export function captureOf(req: RenderRequest): { density: number; take: (ready: ReadyPage) => Promise<Shot> } {
  const requestedCrop = typeof req.capture === 'object' && 'card' in req.capture ? req.capture.card : null;
  // A crop narrower than the output must be RASTERIZED at the corresponding
  // density. Scaling a 637px screenshot to 1600px only enlarges its pixels.
  const cardDensity = requestedCrop
    ? clamp(req.viewport.width / Math.max(1, requestedCrop.width), 1, 4)
    : 1;
  const element = typeof req.capture === 'object' && 'element' in req.capture ? req.capture : null;
  // An element is drawn at twice its CSS pixels, so a chart dropped into a slide stays sharp (see ELEMENT_CAPTURE).
  return { density: element ? ELEMENT_CAPTURE.density : cardDensity, take: async ({ page, surface, timeout, waitForCharts }) => {
    const shotOpts = { timeout, ...(req.format === 'jpg' ? { type: 'jpeg' as const, quality: req.quality ?? 85 } : { type: 'png' as const }) };
    const mime = req.format === 'jpg' ? 'image/jpeg' as const : 'image/png' as const;
    const slideNumber = typeof req.capture === 'object' && 'slide' in req.capture ? req.capture.slide ?? 0 : 0;
    let slide: Locator | null = null;
    if (slideNumber > 0) {
      // Number the slides the author check counts (toolbox-check-capture.mjs and toolbox-check-slides.mjs, pinned
      // alike by a stacked deck in contract.test.ts and session-pages.test.ts): laid out and outside deck chrome,
      // so the hidden rail miniatures bare readers keep for hydration take no number. A stacked deck hides all but
      // its active slide; the slide is marked and revealed alone, the others hidden, as the check draws it.
      const slides = surface.locator('[data-af-slide]');
      const laid = await slides.evaluateAll(els => els.flatMap((el, i) => {
        const box = el.getBoundingClientRect();
        return !el.closest('[data-af-deck-chrome]') && box.width > 1 && box.height > 1 ? [i] : [];
      }));
      if (slideNumber > laid.length) throw new NoSlideError(laid.length);
      slide = slides.nth(laid[slideNumber - 1]!);
      await slide.evaluate(el => el.setAttribute('data-af-slide-shot', ''));
      await page.addStyleTag({ content: SLIDE_REVEAL_CSS });
      await slide.scrollIntoViewIfNeeded({ timeout });
    }
    if (element) {
      // Matched under the slide when one was asked for, else under the surface; shot by the mark, at 1x past half the cap.
      const marked = await (slide ?? surface).evaluate(markElement, { selector: element.element, mark: ELEMENT_SHOT, max: ELEMENT_CAPTURE.maxCssPx });
      if (marked.why) throw new NoElementError({ ok: false, reason: 'no_element', ...marked });
      const one = page.locator(`[${ELEMENT_SHOT}]`).first();
      await one.scrollIntoViewIfNeeded({ timeout });
      await waitForCharts();
      const dense = Math.max(marked.width, marked.height) * ELEMENT_CAPTURE.density <= ELEMENT_CAPTURE.maxCssPx;
      return { mime, bytes: new Uint8Array(await one.screenshot({ ...shotOpts, style: DECK_CHROME_HIDDEN, ...(dense ? {} : { scale: 'css' as const }) })) };
    }
    if (slide) {
      await waitForCharts();
      return { mime, bytes: new Uint8Array(await slide.screenshot({ ...shotOpts, style: DECK_CHROME_HIDDEN })) };
    }
    if (req.capture === 'full') return { mime, bytes: new Uint8Array(await surface.screenshot(shotOpts)) };
    if (req.capture === 'preview' || typeof req.capture === 'object') {
      const { width: outputWidth, height: outputHeight } = req.viewport;
      const box = (await surface.boundingBox()) ?? { x: 0, y: 0, width: outputWidth, height: outputHeight };
      const crop = requestedCrop;
      const sourceWidth = crop
        ? clamp(crop.width, 1, Math.max(1, box.width))
        : Math.min(Math.max(1, box.width), outputWidth);
      const sourceHeight = crop
        ? sourceWidth * outputHeight / outputWidth
        : Math.max(1, box.height);
      const x = crop ? clamp(crop.x, 0, Math.max(0, box.width - sourceWidth)) : 0;
      const y = crop ? clamp(crop.y, 0, Math.max(0, box.height - sourceHeight)) : 0;
      if (crop) {
        // page.screenshot honors deviceScaleFactor; CDP clip.scale does not
        // increase raster density and produced a visibly enlarged bitmap.
        const initialScrollY = await page.evaluate(() => window.scrollY);
        const documentY = initialScrollY + box.y + y;
        await page.evaluate((top) => window.scrollTo(0, top), documentY);
        const scrollY = await page.evaluate(() => window.scrollY);
        await waitForCharts();
        const bytes = await page.screenshot({
          // Keep the high-density intermediate lossless. JPEG is encoded
          // once, after the fractional clip is normalized to exact output.
          type: 'png',
          timeout,
          clip: { x: box.x + x, y: documentY - scrollY, width: sourceWidth, height: sourceHeight },
        });
        // Fractional clip edges round at device pixels. The public contract
        // remains exact even when the chosen width is not a clean divisor.
        const exactPipeline = sharp(bytes).resize(outputWidth, outputHeight, { fit: 'fill' });
        const exact = req.format === 'jpg'
          ? await exactPipeline.jpeg({ quality: req.quality ?? 85 }).toBuffer()
          : await exactPipeline.png().toBuffer();
        return { mime, bytes: new Uint8Array(exact) };
      }
      const client = await page.context().newCDPSession(page);
      try {
        const scale = Math.min(PREVIEW_WIDTH / sourceWidth, PREVIEW_MAX_HEIGHT / sourceHeight);
        await waitForCharts();
        const captured = await client.send('Page.captureScreenshot', {
          format: req.format === 'jpg' ? 'jpeg' : 'png',
          ...(req.format === 'jpg' ? { quality: req.quality ?? 85 } : {}),
          fromSurface: true,
          captureBeyondViewport: true,
          clip: {
            x: box.x + x,
            y: box.y + y,
            width: sourceWidth,
            height: sourceHeight,
            scale,
          },
        });
        const bytes = Buffer.from(captured.data, 'base64');
        return { mime, bytes: new Uint8Array(bytes) };
      } finally {
        await client.detach().catch(() => {});
      }
    }
    // card: clip the PAGE to the surface's top stage; grow the viewport by the surface's offset so the clip is full height.
    const { width, height } = req.viewport;
    let box = (await surface.boundingBox()) ?? { x: 0, y: 0, width, height };
    await page.setViewportSize({ width, height: Math.ceil(box.y) + height });
    box = (await surface.boundingBox()) ?? box;
    await waitForCharts();
    const bytes = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, width) || width, height }, ...shotOpts });
    return { mime, bytes: new Uint8Array(bytes) };
  } };
}

/** One load's drawings, bounded (SVG_HARVEST_LIMITS), from its ready page. */
export async function harvestDrawings(req: SvgHarvestRequest, { page }: ReadyPage): Promise<HarvestedSvg[]> {
  const found = await page.evaluate(collectDrawings, { selector: req.selector, collect: req.collect, limit: SVG_HARVEST_LIMITS.images + 1 });
  if (found.length > SVG_HARVEST_LIMITS.images) throw new Error('Too many drawings');
  let total = 0;
  return found.map(({ attributes, width, height, src }) => {
    const svg = svgFromDataUrl(src);
    total += svg.length;
    if (svg.length > SVG_HARVEST_LIMITS.imageBytes || total > SVG_HARVEST_LIMITS.totalBytes) throw new Error('Drawings too large');
    return { attributes, width, height, svg };
  });
}
