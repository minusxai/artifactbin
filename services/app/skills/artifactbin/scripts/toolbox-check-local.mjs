/**
 * Internal: check.mjs's local browser: a disposable headless Chromium limited to the origin of a
 * serve.mjs preview.
 * Used by: check.mjs (re-export), toolbox-check-command.mjs.
 */
import {ToolError} from './toolbox-client.mjs';
import {inspectPage} from './toolbox-check-inspect.mjs';
import {checkTarget, summarizeCheck} from './toolbox-check-script.mjs';

// Local: a disposable headless Chromium that can only reach the preview's own origin.
export async function checkLocal({target, viewports, steps = '', capture = false}, chromium) {
  const selected = checkTarget(target);
  if (selected.mode !== 'local') throw Error('Local checks require a loopback preview URL.');
  // launch() creates a disposable temporary profile; never attach to an existing browser or
  // userDataDir.
  let browser;
  try {
    browser = await chromium.launch({headless: true});
  } catch {
    throw new ToolError(
      'browser_dependency_missing',
      'Chromium could not start in this harness.',
      1,
      'Install the Playwright Chromium build and its OS dependencies.'
    );
  }
  try {
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === selected.origin ? route.continue() : route.abort('blockedbyclient');
    });
    const checks = [];
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    for (const viewport of viewports) {
      const page = await context.newPage();
      try {
        checks.push(
          await inspectPage(
            page,
            {target, viewport, capture, compareReload: viewport === viewports[0]},
            steps ? new AsyncFunction('page', 'step', steps) : null
          )
        );
      } finally {
        await page.close();
      }
    }
    return summarizeCheck(checks);
  } finally {
    await browser.close();
  }
}
