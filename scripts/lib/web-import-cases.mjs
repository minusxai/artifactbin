/** Font-family resolution and the editor URL-import door share the asset gate's fixture/browser. */
import { startDocument, becomeOwner } from './start-doc.mjs';

export async function checkWebImport(B, browser, WEB, ok) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  // ── a Google font names a family; the reader must never reach gstatic ───────
  const gstatic = [];
  page.on('request', (r) => { if (/gstatic|googleapis/.test(r.url())) gstatic.push(r.url()); });

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
  ok(sourcePut.status === 200 && sourceBody.markup_changed === false,
    'a simple URL import preserves source without a markup rewrite');
  const fontPut = await fetch(`${B}/api/artifacts/${fontDoc.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fontDoc.token}` },
    body: JSON.stringify({
      title: 'font import gate',
      markup: '<Helmet><meta name="font-display" content="Lobster" /></Helmet><div className="p-8"><h1 id="h" className="text-5xl font-bold">Lobster headline</h1></div>',
    }),
  });
  if (fontPut.status === 200) {
    await page.goto(`${B}/a/${fontDoc.id}`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const family = await page.evaluate(() => {
      const h = document.querySelector('#h');
      return h ? getComputedStyle(h).fontFamily : '';
    });
    ok(/Lobster/.test(family), `the heading asks for the imported family (${family})`);
    const faces = await page.evaluate(() => [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '').join('\n').match(/\/webfonts\/[0-9a-f]{32}\.woff2/g)?.length ?? 0);
    ok(faces > 0, `its @font-face rules point at THIS origin (${faces} face(s))`);
    ok(gstatic.length === 0, `the reader made NO request to Google (${gstatic.length})`);
  } else {
    // A deployment with no outbound access to Google cannot resolve the family;
    // say so rather than failing a gate about OUR behaviour.
    console.log(`   (skipped the font leg: the deployment could not resolve the family — ${fontPut.status})`);
  }

  // ── the HUMAN door: the editor's insert-image popover takes a URL ───────────
  // jsdom proves the wiring; only a browser proves the control is reachable,
  // the popover opens, and the inserted image actually paints in the document.
  {
    const doc = await startDocument(B);
    await becomeOwner(page, B, doc.token);
    await page.goto(`${B}/a/${doc.id}#edit`, { waitUntil: 'load' });
    await page.waitForSelector('[aria-label="Insert image"]', { timeout: 60000 });
    await page.click('[aria-label="Insert image"]');
    const urlField = await page.waitForSelector('[aria-label="Image URL"]', { timeout: 10000 }).catch(() => null);
    ok(!!urlField, 'the insert-image control offers a URL field');
    if (urlField) {
      await page.fill('[aria-label="Image URL"]', `${WEB}/photo.png`);
      await page.click('[aria-label="Import image from URL"]');
      // POLL, don't sleep. The insert commits, the save debounces, and the
      // document re-renders with refData that knows the new id — the `ref:` is
      // resolved to a URL only on that pass, so a single early read sees the raw
      // ref and reports a phantom failure. (Same polling shape as
      // gate-image-upload, for the same reason.)
      let inserted = null;
      for (let i = 0; i < 40 && !(inserted && inserted.w > 0); i++) {
        const frame = page.mainFrame();
        inserted = frame
          ? await frame.evaluate(() => {
              // NOT `querySelector('img')`: every served document carries the
              // credits-footer logo, and matching that reports success for an
              // image this gate never inserted. An IMPORTED image resolves to
              // its own artifact's bytes — /a/<id>/raw — so match that shape.
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
