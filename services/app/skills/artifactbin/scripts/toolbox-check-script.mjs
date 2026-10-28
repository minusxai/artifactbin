/**
 * Internal: check.mjs's pure pieces: target and steps parsing, the Playwright loader for local
 * checks, the hosted script source and the smoke summary.
 * Used by: check.mjs (re-export), toolbox-check-hosted.mjs, toolbox-check-command.mjs.
 */
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ToolError} from './toolbox-client.mjs';
import {PARTS, inspectPage} from './toolbox-check-inspect.mjs';

/** Resolve both named ESM and CommonJS default exports before attempting a browser launch. */
export async function loadChromium(modulePath) {
  let module;
  try {
    module = await import(modulePath ? pathToFileURL(realpathSync(modulePath)).href : 'playwright');
  } catch {
    throw new ToolError(
      'browser_dependency_missing',
      'Local checks could not load Playwright.',
      1,
      'Install Playwright in the isolated harness and pass its entrypoint with --playwright-module.'
    );
  }
  const chromium =
    typeof module.chromium?.launch === 'function' ? module.chromium : module.default?.chromium;
  if (typeof chromium?.launch !== 'function')
    throw new ToolError(
      'browser_module_invalid',
      'Selected module does not export chromium.launch.',
      2,
      'Pass a Playwright CommonJS or ESM entrypoint.'
    );
  return chromium;
}
export function checkTarget(value) {
  if (/^[A-Za-z0-9]{6,}$/.test(value)) return {mode: 'hosted', target: '/a/' + value};
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('Use an artifact ID or an HTTP loopback preview URL.');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error('Use an artifact ID or an HTTP loopback preview URL.');
  return {mode: 'local', target: url.href, origin: url.origin};
}
/** A steps file written as a module (export default async function(page){…} or async ({page}) =>
 * …) as a function body. */
export function stepsBody(source) {
  const match = /^\s*export\s+default\s+/m.exec(source);
  if (!match) return source;
  return (
    source.slice(0, match.index) +
    'const __afSteps = ' +
    source.slice(match.index + match[0].length) +
    "\n;return await __afSteps(page, typeof step === 'function' ? step : undefined);"
  );
}
/**
 * The function's source without full-line comments and indentation: the session accepts 64 KB of
 * script and the steps file may take 48 KB of it, so readable source must not cost script budget.
 * Line breaks are kept.
 */
export function compactSource(fn) {
  return fn
    .toString()
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{2,}/g, '\n');
}
/** inspectPage as one self-contained expression with PARTS defined from their source. */
export function inspectSource() {
  const parts = Object.entries(PARTS).map(([key, fn]) => `${key}:${compactSource(fn)}`);
  return `((PARTS)=>${compactSource(inspectPage)})({${parts.join(',')}})`;
}
export function checkScript({
  target,
  viewports,
  steps = '',
  timeoutMs = 2500,
  capture = false,
  compareReload = false
}) {
  if (!viewports || viewports.length !== 1)
    throw Error('Each hosted execution checks one viewport.');
  const options = {target, viewport: viewports[0], timeoutMs, hosted: true, capture, compareReload};
  return (
    `const page=await context.newPage();try{return await (${inspectSource()})(page,` +
    `${JSON.stringify(options)},${steps ? `async(page,step)=>{${steps}\n}` : 'null'});}` +
    'finally{await page.close();}'
  );
}
/** @returns {import('../../../lib/skills/author-toolbox-contract').AuthorCheckResult} */
// Smoke passes only without errors, overflow, unreadable text or duplicate ids; task and visual
// acceptance stay unverified.
export function summarizeCheck(checks) {
  return {
    smokePassed:
      checks.length > 0 &&
      checks.every(
        check =>
          !check.error &&
          !check.inspectionError &&
          check.overflow?.fits === true &&
          check.text.length > 0 &&
          !check.contrast?.unreadable &&
          !check.ids?.duplicates &&
          ['pageErrors', 'consoleErrors', 'failedRequests', 'httpErrors'].every(
            key => check[key]?.length === 0
          )
      ),
    checks,
    unverified: ['visual appearance', 'task behavior', 'persistence', 'permissions'],
    note:
      'Smoke evidence only. Inspect task results separately; text and geometry cannot establish ' +
      'visual acceptance.'
  };
}
