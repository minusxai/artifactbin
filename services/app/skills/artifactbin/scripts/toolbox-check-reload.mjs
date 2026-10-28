/**
 * Internal: check.mjs's wait for a loaded page and its reload comparison of script-made ids. Both
 * are injected into inspectPage and serialized into the hosted script, so each references only its
 * own parameters.
 * Used by: toolbox-check-inspect.mjs (PARTS).
 */

/** After any load: wait until the document frame commits (it is found by name), not the reader
 * shell. */
export async function ready(page, hosted) {
  if (hosted) {
    const host = page.mainFrame().locator('iframe[data-mx-document-frame]');
    await host.waitFor({timeout: 2000});
    for (
      const end = Date.now() + 3000;
      Date.now() < end;
      await new Promise(resolve => setTimeout(resolve, 50))
    ) {
      const frame = await host
        .elementHandle({timeout: 500})
        .then(handle => handle?.contentFrame())
        .catch(() => null);
      if (frame && !frame.isDetached() && frame.name() && !/^(about:blank)?$/.test(frame.url()))
        break;
    }
  }
  await page.locator('body').waitFor({timeout: 2000});
  // The reader shows an aria-busy "Loading page…" placeholder first; measure the page, not the
  // placeholder.
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {timeout: 5000})
    .catch(() => {});
}

/** The idStability evidence: script-made ids the reload lost, or why the comparison was skipped. */
export async function reloadIds(page, ready) {
  // Only script-created IDs (live minus the runtime's savedNodeIds) can drift between renders; with
  // none, skip the reload.
  try {
    // Compare both loads once script-made elements stop appearing.
    const settle = () =>
      page
        .locator('html')
        .evaluate(
          async html => {
            const count = () => html.ownerDocument.querySelectorAll('[data-af-id]').length;
            let last = -1,
              same = 0;
            for (const end = Date.now() + 3000; Date.now() < end && same < 2; ) {
              await new Promise(resolve => setTimeout(resolve, 250));
              const now = count();
              same = now === last ? same + 1 : 0;
              last = now;
            }
          },
          undefined,
          {timeout: 3500}
        );
    const readIds = () =>
      page.locator('html').evaluate(
        html => {
          let saved = null;
          try {
            const list = JSON.parse(
              html.ownerDocument.querySelector('script[data-af="runtime"]')?.textContent || 'null'
            )?.savedNodeIds;
            if (Array.isArray(list)) saved = list;
          } catch {}
          return {
            ids: [
              ...new Set(
                [...html.ownerDocument.querySelectorAll('[data-af-id]')]
                  .map(node => node.getAttribute('data-af-id'))
                  .filter(Boolean)
              )
            ],
            saved
          };
        },
        undefined,
        {timeout: 1500}
      );
    await settle();
    const first = await readIds(),
      savedIds = new Set(first.saved ?? []),
      created = first.ids.filter(id => !savedIds.has(id));
    if (!created.length) return {checked: false, created: 0};
    await page.reload({waitUntil: 'domcontentloaded', timeout: 4000});
    await ready();
    await settle();
    // Wait for the reload to render as many script-made ids as the first load.
    let again = [];
    for (const end = Date.now() + 4000; ; await new Promise(resolve => setTimeout(resolve, 250))) {
      again = (await readIds()).ids.filter(id => !savedIds.has(id));
      if (again.length >= created.length || Date.now() > end) break;
    }
    const after = new Set(again);
    // Count only ids the reload lost; new ones may be a later render.
    const changed = created.filter(id => !after.has(id));
    return {
      checked: true,
      created: created.length,
      unstable: changed.length,
      sample: changed.slice(0, 5)
    };
  } catch (error) {
    return {
      checked: false,
      skipped: 'reload comparison skipped: ' + String(error.message).split('\n')[0].slice(0, 120)
    };
  }
}
