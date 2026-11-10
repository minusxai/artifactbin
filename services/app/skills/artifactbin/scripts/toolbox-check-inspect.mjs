/**
 * Internal: check.mjs's inspection of one page at one viewport: load it, optionally compare ids
 * across a reload, run the steps, then measure the settled page. inspectPage runs in the server
 * browser session as source (inspectSource in toolbox-check-script.mjs wires PARTS in) or in a
 * local browser context; it references nothing outside its parameters and PARTS.
 * Used by: check.mjs (re-export), toolbox-check-script.mjs, toolbox-check-hosted.mjs.
 */
import {ready, reloadIds} from './toolbox-check-reload.mjs';
import {runSteps} from './toolbox-check-steps.mjs';
import {layout, overflow, ids} from './toolbox-check-probes.mjs';
import {contrast} from './toolbox-check-contrast.mjs';
import {slides} from './toolbox-check-slides.mjs';
import {calls, callKind} from './toolbox-check-calls.mjs';
import {capture} from './toolbox-check-capture.mjs';

/** The self-contained parts inspectPage calls; the hosted script defines each from its source. */
export const PARTS = {
  ready, reloadIds, runSteps, layout, overflow, ids, contrast, slides, calls, callKind, capture
};

/** Runs in either the server session or a fresh local browser context. No credentials. */
// One page, one viewport: load it, optionally compare IDs across a reload, run the steps, then
// measure the settled page.
export async function inspectPage(page, options, task, parts = PARTS) {
  const pageErrors = [],
    consoleErrors = [],
    failedRequests = [],
    httpErrors = [],
    telemetry = [],
    callErrors = [],
    callReads = [],
    unreachable = [];
  // A hosted check's browser reaches only the platform's own sites and Google Fonts (no internet):
  // a request elsewhere fails there yet loads for readers, so it is listed, never a page failure.
  const site = host => host.split('.').slice(-2).join('.');
  const offPlatform = value => {
    try {
      const {host, protocol} = new URL(value);
      const fonts = /(^|\.)(googleapis|gstatic)\.com$/.test(host);
      if (!options.hosted || !/^https?:$/.test(protocol) || fonts) return false;
      const sites = page.frames().map(frame => {
        try { return site(new URL(frame.url()).host); } catch { return ''; }
      });
      return !sites.includes(site(host));
    } catch {
      return false;
    }
  };
  const classify = value => {
    try {
      const url = new URL(value);
      return (
        url.origin === new URL(page.url()).origin &&
        /^\/api\/page\/artifact\/[A-Za-z0-9]+\/view$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  };
  const record = (list, item) => {
    if (list.length < 100) list.push(item);
  };
  page.on('pageerror', error => record(pageErrors, String(error.message)));
  page.on('console', message => {
    if (message.type() === 'error') {
      const url = message.location?.().url;
      // A refused sql, function or GraphQL call is reported once, as a call failure (below).
      if (url && parts.callKind(url)) return;
      if (url && classify(url)) record(telemetry, {url, error: message.text()});
      else if (!(url && offPlatform(url))) record(consoleErrors, message.text());
    }
  });
  // A main-frame navigation (e.g. a step's reload) cancels requests that started before it; those
  // aborts are not page failures.
  let navigation = 0;
  const started = new WeakMap();
  // The page's dataset reads, on load and in its steps: its sql, its functions, an older page's
  // GraphQL and its live dataset cells. check fails a linked dataset that none read.
  let datasetReads = 0;
  const cell = /^\/api\/(?:artifacts|local-connection)\/[^/]+\/regions\/cell(?::|%3A)/i;
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation++;
    started.set(request, navigation);
    try {
      if (parts.callKind(request.url()) || cell.test(new URL(request.url()).pathname))
        datasetReads++;
    } catch {}
  });
  // The reader's own comment fetch is cancelled whenever a step reloads or navigates; it is reader
  // chrome, not the page.
  const readerFetch = value => {
    try {
      const url = new URL(value);
      return (
        url.origin === new URL(page.url()).origin &&
        /^\/api\/my\/artifacts\/[A-Za-z0-9]+\/annotations$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  };
  // A link answered with a file starts a download and its navigation ends net::ERR_ABORTED: that
  // request is the download (listed in downloads), not a failure.
  const downloads = [],
    aborts = new WeakSet();
  page.on('download', item => record(downloads, {url: item.url(), file: item.suggestedFilename()}));
  page.on('requestfailed', request => {
    const item = {url: request.url(), error: request.failure()?.errorText};
    if (offPlatform(item.url)) return record(unreachable, new URL(item.url).origin);
    if (item.error === 'net::ERR_ABORTED' && request.isNavigationRequest()) aborts.add(item);
    const aborted =
      item.error === 'net::ERR_ABORTED' &&
      (started.get(request) < navigation || readerFetch(item.url));
    record(
      classify(item.url) || aborted ? telemetry : failedRequests,
      aborted ? {...item, reason: 'navigation'} : item
    );
  });
  page.on('response', response => {
    if (response.status() >= 400 && !parts.callKind(response.url())) {
      const item = {url: response.url(), status: response.status()};
      record(classify(item.url) ? telemetry : httpErrors, item);
    }
    // A failed call, with the owner-only detail and the page and console errors before it.
    const before = {pageErrorsBefore: pageErrors.length, consoleErrorsBefore: consoleErrors.length};
    parts.calls(response, before, callErrors, callReads, parts.callKind);
  });
  page.setDefaultTimeout(options.timeoutMs ?? 4000);
  const evidence = {
    viewport: options.viewport,
    pageErrors,
    consoleErrors,
    failedRequests,
    httpErrors,
    telemetry,
    unreachable,
    text: '',
    overflow: null,
    task: null
  };
  const ready = () => parts.ready(page, options.hosted);
  try {
    await page.setViewportSize(options.viewport);
    await page.goto(options.target, {waitUntil: 'domcontentloaded', timeout: 4000});
    // Do not wait for networkidle: charts, telemetry and subscriptions can remain active.
    await ready();
    if (options.compareReload) evidence.idStability = await parts.reloadIds(page, ready);
    if (task) await parts.runSteps(page, options.hosted, task, ready, evidence);
  } catch (error) {
    evidence.error = String(error.message);
  }
  try {
    // Measure settled layout: fonts loaded, transitions done, then layout unchanged across two
    // frames.
    await page.evaluate(parts.layout).catch(() => {});
    evidence.text = (await page.locator('body').innerText({timeout: 1000})).slice(0, 24000);
    const html = page.locator('html');
    evidence.overflow = await html.evaluate(parts.overflow, undefined, {timeout: 1000});
    // Duplicate data-af-id values in the live DOM (after any steps): comments and edits address
    // elements by this ID.
    evidence.ids = await html.evaluate(parts.ids, undefined, {timeout: 1000});
    evidence.contrast = await html.evaluate(parts.contrast, undefined, {timeout: 1500});
    evidence.slides = await html.evaluate(parts.slides, undefined, {timeout: 1500});
  } catch (error) {
    evidence.inspectionError = String(error.message);
  }
  // The call bodies still being read, for at most a second.
  let wait;
  const late = new Promise(resolve => (wait = setTimeout(resolve, 1000)));
  await Promise.race([Promise.allSettled(callReads), late]);
  clearTimeout(wait);
  if (options.capture)
    try {
      // The document's full height (capped); a deck keeps its viewport.
      evidence.screenshot = await parts.capture(page, options, evidence.slides?.count > 0);
    } catch (error) {
      evidence.screenshotError = String(error.message);
    }
  // Do not let page-close cancellation events mutate evidence already collected.
  const downloaded = new Set(downloads.map(item => item.url));
  return {
    ...evidence,
    pageErrors: [...pageErrors],
    consoleErrors: [...consoleErrors],
    failedRequests: failedRequests.filter(item => !(aborts.has(item) && downloaded.has(item.url))),
    ...(downloads.length ? {downloads: [...downloads]} : {}),
    httpErrors: [...httpErrors],
    telemetry: [...telemetry],
    unreachable: [...new Set(unreachable)],
    datasetReads,
    ...(callErrors.length ? {callErrors: [...callErrors]} : {})
  };
}
