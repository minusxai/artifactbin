import {fixtureFetch as fetch} from './fixture-http.mjs';
/**
 * The font metas and the editor URL-import door share the asset gate's fixture/browser. A simple URL import keeping
 * its source unrewritten is web-import.test.ts's ("stores no asset row, fetches nothing and serves the original URL").
 */
import { startDocument, becomeOwner } from '../../lib/start-doc.mjs';
import { documentFrame } from './page-facts.mjs';

export async function checkWebImport(B, browser, WEB, ok) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  // ── a Google font names a family; the document's own font sheet imports it ─
  const fontDoc = await startDocument(B);
  const fontPut = await fetch(`${B}/api/artifacts/${fontDoc.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fontDoc.token}` },
    body: JSON.stringify({
      title: 'font import gate',
      markup: '<Helmet><meta name="font-display" content="Lobster" /></Helmet><div className="p-8"><h1 id="h" className="text-5xl font-bold">Lobster headline</h1></div>',
    }),
  });
  ok(fontPut.status === 200, `a font meta publishes without fetching anything (${fontPut.status})`);
  if (fontPut.status === 200) {
    await page.goto(`${B}/a/${fontDoc.id}`, { waitUntil: 'load' });
    // The document renders in the app page or, on a pages server, in its own-origin frame.
    let read = null;
    for (let i = 0; i < 40 && !read; i++) {
      for (const frame of page.frames()) {
        read = await frame.evaluate(() => {
          const h = document.querySelector('#h');
          if (!h) return null;
          return { family: getComputedStyle(h).fontFamily };
        }).catch(() => null);
        if (read) break;
      }
      if (!read) await page.waitForTimeout(250);
    }
    ok(/Lobster/.test(read?.family ?? ''), `the heading asks for the named family (${read?.family})`);
    // The served font sheet's Google import and the absent /webfonts copy are google-fonts.test.ts's.
  }

  // ── the HUMAN door: the editor's insert-image popover takes a URL ───────────
  // jsdom proves the wiring; only a browser proves the control is reachable,
  // the popover opens, and the inserted image actually paints in the document.
  {
    const doc = await startDocument(B);
    await becomeOwner(page, B, doc.token);
    await page.goto(`${B}/a/${doc.id}#edit`, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Insert image', exact: true }).click({ timeout: 60000 });
    const urlField = await page.waitForSelector('[aria-label="Image URL"]', { timeout: 10000 }).catch(() => null);
    ok(!!urlField, 'the insert-image control offers a URL field');
    if (urlField) {
      await page.fill('[aria-label="Image URL"]', `${WEB}/photo.png`);
      await page.click('[aria-label="Import image from URL"]');
      // The import previews first; Insert places it.
      const insert = page.getByRole('dialog', { name: 'Insert image' }).getByRole('button', { name: 'Insert', exact: true });
      await insert.waitFor();
      for (let i = 0; i < 40 && !(await insert.isEnabled()); i++) await page.waitForTimeout(250);
      await insert.click();
      // POLL, don't sleep. The insert commits, the save debounces, and the
      // document re-renders with refData that knows the new id — the `ref:` is
      // resolved to a URL only on that pass, so a single early read sees the raw
      // ref and reports a phantom failure. (Same polling shape as
      // gate-media's picture leg, for the same reason.)
      let inserted = null;
      for (let i = 0; i < 40 && !(inserted && inserted.w > 0); i++) {
        // The document — edited too — is the app page's frame, on its own origin.
        const frame = await documentFrame(page).catch(() => null);
        inserted = frame
          ? await frame.evaluate(() => {
              // NOT `querySelector('img')`: matching any image reports success for
              // one this gate never inserted. An IMPORTED image resolves to its
              // own artifact's bytes — /a/<id>/raw — so match that shape.
              const img = [...document.querySelectorAll('img')]
                .find((i) => /\/a\/[A-Za-z0-9]+\/raw/.test(i.getAttribute('src') ?? ''));
              return img ? { w: img.naturalWidth, src: img.getAttribute('src') } : null;
            }).catch(() => null)
          : null;
        if (inserted && inserted.w > 0) break;
        await page.waitForTimeout(500);
      }
      ok(!!inserted, 'the imported image was inserted into the document');
      ok(!!inserted && inserted.w > 0, `and it paints (naturalWidth ${inserted?.w ?? 'n/a'})`);
      ok(!!inserted && !/^https?:/.test(inserted.src ?? ''), `from this origin, not the source host (${inserted?.src})`);
    }
  }

  await page.close();
}
