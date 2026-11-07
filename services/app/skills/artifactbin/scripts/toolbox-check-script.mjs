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
// Runs a steps module's default export: a function of (page, step), or step calls awaited in order.
const RUN_DEFAULT = String.raw`
;return await (async (steps, step) => {
const forms = "Steps file: export default must be an async function taking page or {page}, " +
"or an array of step('label', async ({page}) => …) calls; got ";
const rest = ". Or write a plain body of await step('label', async () => {…}) calls: " +
"page and step are in scope.";
if (typeof steps === 'function') return steps(page, step);
if (!Array.isArray(steps)) throw TypeError(forms + (steps === null ? 'null' : typeof steps) + rest);
for (const [i, item] of steps.entries()) {
if (typeof item === 'function' && step) await step('step ' + (i + 1), item);
else if (typeof item?.then === 'function') await item;
else throw TypeError(forms + 'an array whose item ' + (i + 1) + ' is ' + typeof item + rest);
}
})(__afSteps, typeof step === 'function' ? step : undefined);`;
/** A steps file written as a module (export default async ({page}) => …, a function of page, or
 * an array of step(…) calls) as a function body. */
export function stepsBody(source) {
  const match = /^\s*export\s+default\s+/m.exec(source);
  if (!match) return source;
  return (
    source.slice(0, match.index) +
    'const __afSteps = ' +
    source.slice(match.index + match[0].length) +
    RUN_DEFAULT
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
  compareReload = false,
  slides = false
}) {
  if (!viewports || viewports.length !== 1)
    throw Error('Each hosted execution checks one viewport.');
  const options = {
    target, viewport: viewports[0], timeoutMs, hosted: true, capture, compareReload, slides
  };
  return (
    `const page=await context.newPage();try{return await (${inspectSource()})(page,` +
    `${JSON.stringify(options)},${steps ? `async(page,step)=>{${steps}\n}` : 'null'});}` +
    'finally{await page.close();}'
  );
}
/** @returns {import('../../../lib/skills/author-toolbox-contract').AuthorCheckResult} */
// Smoke passes only without errors, overflow, unreadable text or duplicate ids; what steps did not
// cover stays unverified. No note asks for more: "Inspect task results separately; … cannot
// establish visual acceptance" sent agents back to screenshots after clean passes (2026-11-07).
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
    unverified: ['task behavior', 'persistence', 'permissions']
  };
}
