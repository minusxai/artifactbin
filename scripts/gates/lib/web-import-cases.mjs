import {fixtureFetch as fetch} from './fixture-http.mjs';
/** The font metas and the editor URL-import door share the asset gate's fixture/browser. */
import { startDocument, becomeOwner } from '../../lib/start-doc.mjs';
import { documentFrame } from './page-facts.mjs';

export async function checkWebImport(B, browser, WEB, ok) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  // ── a Google font names a family; the document's own font sheet imports it ─
  const fontDoc = await startDocument(B);
  // The combined asset fixture also exercises normalization. Check the
  // no-rewrite response on the original simple image shape, then reuse this
  // document for the font case; an unrelated normalization must not fail it.
  const sourcePut = await fetch(`${B}/api/artifacts/${fontDoc.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fontDoc.token}` },
    body: JSON.stringify({
      title: 'source-preserving import',
      markup: `<div id="root" className="p-8"><h1 id="heading" className="text-2xl font-bold">Imported</h1><img id="shot" src="${WEB}/photo.png" alt="imported" /></div>`,
    }),
  });
  const sourceBody = await sourcePut.json();
  ok(sourcePut.status === 200 && sourceBody.markup?.includes(`src="${WEB}/photo.png"`),
    'a simple URL import preserves source without a markup rewrite');
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
    // The served document's own font sheet, whichever surface the app page draws it in.
    const raw = await (await fetch(`${B}/a/${fontDoc.id}/raw`, { headers: { Authorization: `Bearer ${fontDoc.token}` } })).text();
    ok(/<style data-mx-font-vars>@import url\(https:\/\/fonts\.googleapis\.com\/css2\?family=Lobster:/.test(raw),
      'the served font sheet opens with the Google Fonts import');
    ok(!raw.includes('/webfonts/'), 'no face is served from a copied /webfonts address');
  }

  // ── the HUMAN door: the editor's insert-image popover takes a URL ───────────
  // jsdom proves the wiring; only a browser proves the control is reachable,
  // the popover opens, and the inserted image actually paints in the document.
  {
    const doc = await startDocument(B);
    await becomeOwner(page, B, doc.token);
    await page.goto(`${B}/a/${doc.id}#edit`, { waitUntil: 'load' });
    await page.waitForSelector('[aria-label="Insert"]', { timeout: 60000 });
    await page.click('[aria-label="Insert"]');
    await page.getByRole('button', { name: 'Image…', exact: true }).click();
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
      // gate-image-upload, for the same reason.)
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
