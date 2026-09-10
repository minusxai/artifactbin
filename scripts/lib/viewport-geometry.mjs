/** Real viewport geometry for raw h-screen slides; owned by the layout gate. */
import { becomeOwner, startDocument } from './start-doc.mjs';

export async function checkViewportGeometry(BASE, browser, check) {
  const api = async (path, init = {}, token) => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  const SLIDES = 6;
  const HEADLINE = 'Eat well without making food complicated.';
  // Deliberately verbatim in spirit to what ChatGPT published: h-screen sections,
  // flex-centred content and an arbitrary-value `min-h-[50vh]` exercise both
  // the full-viewport utility and a fractional viewport utility.
  const deck = `<div className="min-h-screen bg-white text-black">
  ${Array.from({ length: SLIDES }, (_, i) => `  <section className="h-screen flex items-center justify-center px-12">
      <div className="max-w-5xl w-full min-h-[50vh]">
        <h${i === 0 ? '1' : '2'} className="text-6xl font-semibold">${i === 0 ? HEADLINE : `Slide ${i + 1}`}</h${i === 0 ? '1' : '2'}>
      </div>
    </section>`).join('\n')}
  </div>`;

  // The token rides the start LINK now, not the response body (lib/agent-session).
  const start = await startDocument(BASE);
  await api(`/api/artifacts/${start.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: 'Viewport units gate', markup: deck, template: 'deck', theme: 'organic', colorMode: 'light' }),
  }, start.token);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await becomeOwner(page, BASE, start.token); // measure the owner's inline document
  await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
  await page.waitForTimeout(4000); // let the surface settle (MutationObserver-driven syncs)

  // Measure the current inline document in the actual browser viewport.
  const frameEl = await page.waitForSelector('[data-mx-inline-story]', { timeout: 20000 });
  const docFrame = page.mainFrame();
  await docFrame.waitForSelector('h1', { timeout: 20000 });
  const frameBox = await frameEl.boundingBox();

  const measured = await docFrame.evaluate(() => {
    const root = document.querySelector('[data-mx-inline-story]') ?? document.body;
    const heading = root?.querySelector('h1');
    const sheet = document.querySelector('style[data-mx-tw]')?.textContent ?? '';
    return {
      viewport: window.innerHeight,
      contentHeight: root ? root.scrollHeight : null,
      sectionHeight: root ? (root.querySelector('section')?.getBoundingClientRect().height ?? null) : null,
      headingTop: heading ? heading.getBoundingClientRect().top : null,
      headingText: heading?.textContent ?? null,
      // Measure the rendered half-viewport height, not just a CSS declaration.
      halfViewportBox: root?.querySelector('[class*="min-h-[50vh]"]')?.getBoundingClientRect().height ?? null,
      sheetHasVw: /100vw/.test(sheet),
    };
  });
  console.log(JSON.stringify(measured, null, 1));

  check(frameBox !== null && frameBox.height > 200, `the inline document has content height (${frameBox?.height}px)`);
  check(
    Math.abs(measured.viewport - page.viewportSize().height) <= 2,
    `the document uses the browser viewport, not its content height (${measured.viewport} vs ${page.viewportSize().height})`,
  );
  // A slide fills the READER's viewport — not the whole document's height.
  check(
    Math.abs(measured.sectionHeight - measured.viewport) <= 2,
    `an h-screen slide is one viewport tall (${measured.sectionHeight} vs ${measured.viewport})`,
  );
  check(
    measured.contentHeight < measured.viewport * (SLIDES + 2),
    `total height stays bounded (${measured.contentHeight} < ${measured.viewport * (SLIDES + 2)})`,
  );
  // The actual user-visible symptom: the first slide's headline was ABOVE the
  // surface, clipped away. It must now be on screen.
  check(measured.headingText === HEADLINE, 'the first slide heading is in the document');
  check(
    measured.headingTop !== null && measured.headingTop >= 0 && measured.headingTop < measured.viewport,
    `the headline is inside the viewport (top=${measured.headingTop})`,
  );
  // The arbitrary-value branch, measured where it matters.
  check(
    measured.halfViewportBox !== null && Math.abs(measured.halfViewportBox - measured.viewport / 2) <= 2,
    `an arbitrary min-h-[50vh] is half the viewport (${measured.halfViewportBox} vs ${measured.viewport / 2})`,
  );

  await page.close();
}
