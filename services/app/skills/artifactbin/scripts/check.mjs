/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Browser smoke and task check of a saved page or a local preview.
Reports errors, overflow, contrast, duplicate ids and your steps; appearance stays unverified.
Usage: node scripts/check.mjs ID|URL|FILE.html [--viewport WxH]... [--steps FILE] [--guest-steps FILE]
       [--cleanup-steps FILE] [--viewer self|guest] [--output FILE]
       node scripts/check.mjs http://127.0.0.1:PORT/ ...   (local preview from serve.mjs; other origins are blocked)
A hosted check (ID, URL or FILE.html) runs in a server browser session: never install Playwright or Chromium; only a
  local serve.mjs preview needs --playwright-module.
Flags: --viewport WIDTHxHEIGHT (repeat up to 8; default 1280x800 and 390x844; decks: 1200x630 and 1280x800 only);
  --steps FILE an async function body receiving page and step (or a module whose export default takes page or
  {page}); wrap each check in await step('what it shows', async()=>{...}) and throw on failure; --guest-steps FILE
  then runs a second, signed-out session on the first viewport (it can read what --steps saved); --cleanup-steps
  FILE then runs signed in, always, even after a failure, to undo test writes; --viewer self (default) or guest
  (hosted only; the page is signed in as you unless guest); --playwright-module FILE (local only: your installed
  Playwright entrypoint). Common: --server ORIGIN, --json, --output FILE (use a new name each run), --help.
Examples:
  node scripts/check.mjs ID --viewport 1280x800 --viewport 390x844 --steps acceptance.mjs --output qa-1.json
  node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs
    --guest-steps guest.mjs --cleanup-steps cleanup.mjs --output qa-1.json
  steps file:  await step('Add shows Saved',async()=>{await page.getByRole('button',{name:'Add'}).click();
               await page.getByText('Saved').waitFor();});
  Assert rendered, rounded text ("$1,240"), not raw numbers. A passing run prints Verified: (the step labels, per
  viewport) and Not verified:; describe testing only by quoting the Verified: line.
Output: --output saves the full JSON and prints one summary line per viewport: errors, overflow, contrast
  (text under 2:1 fails), slides, your task result; each failing item (up to 12 of a kind) names its text and element
  or slide. Smoke fails on page or console errors, failed requests, overflow, unreadable text and duplicate data-af-id
  values (first ids and counts listed). A warning (not a failure) lists script-created data-af-ids that differ
  between two loads; checked on the first viewport, only when the page has any.
Steps: each steps file gets 8 s per viewport and 2.5 s per call, so wait for data first (also after page.reload()),
  use waitForFunction(fn,null,{timeout:4000}) and avoid networkidle. Script-made nodes carry data-af-id, not id:
  select and click them with [data-af-id="…"] (accessible names include CSS ::before/::after text, so use a regex
  name with getByRole). Vega bars and lines are <path>, not <rect>. Skip a no-steps smoke run. page is scoped to
  the page's own document frame (page.mainFrame() reaches the reader chrome); page.keyboard needs no click.
  innerText applies CSS text-transform and keeps newlines: collapse whitespace and match case-insensitively.
  Viewports run concurrently in fresh sessions: guard writes to one (if (page.viewportSize().width > 800)) and
  restore what you change. Past the deadline, the error names the numbered call still running and what the page
  shows. A hosted script is limited to 20 s and 64 KB.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome. Results never contain credentials.`;

/** Browser check contracts. Smoke evidence never implies task or visual acceptance. */
import {readFile, writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  platform,
  positional,
  enumValue,
  credentialRoot,
  ToolError,
  exclusive
} from './toolbox-client.mjs';

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
  const chromium = typeof module.chromium?.launch === 'function' ? module.chromium : module.default?.chromium;
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
/** A steps file written as a module (export default async function(page){…} or async ({page}) => …) as a function body. */
export function stepsBody(source) {
  const match = /^\s*export\s+default\s+/m.exec(source);
  if (!match) return source;
  return source.slice(0, match.index) + 'const __afSteps = ' + source.slice(match.index + match[0].length) + '\n;return await __afSteps(page, typeof step === \'function\' ? step : undefined);';
}
/** Runs in either the server session or a fresh local browser context. No credentials. */
// One page, one viewport: load it, optionally compare IDs across a reload, run the steps, then measure the settled page.
export async function inspectPage(page, options, task) {
  const pageErrors = [],
    consoleErrors = [],
    failedRequests = [],
    httpErrors = [],
    telemetry = [];
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
      if (url && classify(url)) record(telemetry, {url, error: message.text()});
      else record(consoleErrors, message.text());
    }
  });
  // A main-frame navigation (e.g. a step's reload) cancels requests that started before it; those aborts are not page failures.
  let navigation = 0;
  const started = new WeakMap();
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation++;
    started.set(request, navigation);
  });
  // The reader's own comment fetch is cancelled whenever a step reloads or navigates; it is reader chrome, not the page.
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
  page.on('requestfailed', request => {
    const item = {url: request.url(), error: request.failure()?.errorText};
    const aborted =
      item.error === 'net::ERR_ABORTED' && (started.get(request) < navigation || readerFetch(item.url));
    record(
      classify(item.url) || aborted ? telemetry : failedRequests,
      aborted ? {...item, reason: 'navigation'} : item
    );
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      const item = {url: response.url(), status: response.status()};
      record(classify(item.url) ? telemetry : httpErrors, item);
    }
  });
  page.setDefaultTimeout(options.timeoutMs ?? 4000);
  const evidence = {
    viewport: options.viewport,
    pageErrors,
    consoleErrors,
    failedRequests,
    httpErrors,
    telemetry,
    text: '',
    overflow: null,
    task: null
  };
  // After any load: wait until the document frame commits (it is found by name), not the reader shell.
  const ready = async () => {
    if (options.hosted) {
      const host = page.mainFrame().locator('iframe[data-mx-document-frame]');
      await host.waitFor({timeout: 2000});
      for (const end = Date.now() + 3000; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) {
        const frame = await host
          .elementHandle({timeout: 500})
          .then(handle => handle?.contentFrame())
          .catch(() => null);
        if (frame && !frame.isDetached() && frame.name() && !/^(about:blank)?$/.test(frame.url())) break;
      }
    }
    await page.locator('body').waitFor({timeout: 2000});
    // The reader shows an aria-busy "Loading page…" placeholder first; measure the page, not the placeholder.
    await page
      .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {timeout: 5000})
      .catch(() => {});
  };
  try {
    await page.setViewportSize(options.viewport);
    await page.goto(options.target, {waitUntil: 'domcontentloaded', timeout: 4000});
    // Do not wait for networkidle: charts, telemetry and subscriptions can remain active.
    await ready();
    if (options.compareReload) {
      // Only script-created IDs (live minus the runtime's savedNodeIds) can drift between renders; with none, skip the reload.
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
        if (!created.length) evidence.idStability = {checked: false, created: 0};
        else {
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
          evidence.idStability = {
            checked: true,
            created: created.length,
            unstable: changed.length,
            sample: changed.slice(0, 5)
          };
        }
      } catch (error) {
        evidence.idStability = {
          checked: false,
          skipped: 'reload comparison skipped: ' + String(error.message).split('\n')[0].slice(0, 120)
        };
      }
    }
    if (task) {
      // Whether the steps ran and passed; a failure's message is in error (a bare true here once read as "passed").
      evidence.steps = {ran: true, passed: false};
      // step(label, fn) runs fn and records label as verified; the summary's Verified: line lists them.
      const verified = (evidence.verified = []);
      const step = async (label, fn) => {
        await fn();
        verified.push(String(label).slice(0, 160));
      };
      // Keyboard focus in the page's document, so page.keyboard reaches it without a click first.
      if (options.hosted)
        await page.mainFrame().locator('iframe[data-mx-document-frame]').focus({timeout: 1000}).catch(() => {});
      await page
        .locator('html')
        .evaluate(html => html.ownerDocument.defaultView.focus(), undefined, {timeout: 1000})
        .catch(() => {});
      // Name the steps-file call that failed or was still pending, numbered so a call repeated after a reload is told apart.
      const pending = new Map();
      let failed = null,
        sequence = 0,
        expired = false;
      const show = arg => {
        try {
          return typeof arg === 'function' ? String(arg) : JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      };
      const wrap = (target, label) =>
        new Proxy(target, {
          get(object, key, receiver) {
            // A module-style steps file may destructure ({page}) from its argument.
            if (key === 'page' && label === 'page') return receiver;
            const value = Reflect.get(object, key);
            if (typeof value !== 'function' || typeof key !== 'string') return value;
            return (...args) => {
              const text = `${label}.${key}(${args.map(show).join(', ')})`.replace(/\s+/g, ' ').slice(0, 240),
                id = ++sequence,
                call = `#${id} ${text}`;
              let result = value.apply(object, args);
              // A reload or navigation replaces the document frame: wait for the new one so later calls act on the page.
              if (label === 'page' && (key === 'reload' || key === 'goto') && result && typeof result.then === 'function')
                result = result.then(async response => {
                  await ready();
                  return response;
                });
              if (result && typeof result.then === 'function') {
                pending.set(id, call);
                result.then(
                  () => pending.delete(id),
                  () => {
                    pending.delete(id);
                    if (!expired) failed ??= call;
                  }
                );
              } else if (
                result &&
                typeof result === 'object' &&
                /^(locator|getBy|first|last|nth|filter|frameLocator)/.test(key)
              )
                return wrap(result, text);
              return result;
            };
          }
        });
      let timer;
      try {
        evidence.task = await Promise.race([
          task(wrap(page, 'page'), step),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error('Task deadline exceeded; inspect the awaited condition')),
              8000
            );
          })
        ]);
        evidence.steps.passed = true;
      } catch (error) {
        const deadline = /^Task deadline exceeded/.test(error.message);
        expired = true;
        const latest = [...pending.values()].pop(),
          call = deadline ? (latest ?? failed) : (failed ?? latest);
        // At the deadline, say what the page shows: its live status regions and the start of its visible text.
        let shows = '';
        if (deadline) {
          const seen = await Promise.race([
            page
              .locator('html')
              .evaluate(
                html => {
                  const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
                  const doc = html.ownerDocument;
                  return {
                    status: [...doc.querySelectorAll('#status,[role=status],[role=alert],[aria-live]')]
                      .map(node => tidy(node.textContent).slice(0, 120))
                      .filter(Boolean)
                      .slice(0, 3),
                    text: tidy(doc.body?.innerText).slice(0, 200)
                  };
                },
                undefined,
                {timeout: 1000}
              )
              .catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 1000))
          ]);
          if (seen)
            shows =
              (seen.status.length ? `; status: ${seen.status.map(value => JSON.stringify(value)).join(', ')}` : '') +
              `; page text: ${JSON.stringify(seen.text)}`;
        }
        // A timed-out role lookup usually missed on the name.
        const hint =
          /Timeout/.test(error.message) && /getByRole\(/.test(call ?? '')
            ? '; hint: accessible names include CSS ::before/::after text, so click script-made controls by [data-af-id="…"] or a regex name'
            : '';
        throw call || shows ? Error(`${error.message}${call ? ` (step call ${call})` : ''}${shows}${hint}`) : error;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    evidence.error = String(error.message);
  }
  try {
    // Measure settled layout: fonts loaded, transitions done, then layout unchanged across two frames.
    await page
      .evaluate(async () => {
        const within = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);
        const frames = () =>
          new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await within(document.fonts?.ready, 1500);
        await within(Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))), 1000);
        const shape = () =>
          [document.body.scrollWidth, document.body.scrollHeight]
            .concat(
              [...document.querySelectorAll('[data-af-slide], [data-af-slide] svg')].slice(0, 200).map(node => {
                const box = node.getBoundingClientRect();
                return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`;
              })
            )
            .join('|');
        let last = null;
        for (const end = Date.now() + 1500; Date.now() < end; ) {
          await frames();
          const now = shape();
          if (now === last) break;
          last = now;
        }
      })
      .catch(() => {});
    evidence.text = (await page.locator('body').innerText({timeout: 1000})).slice(0, 24000);
    evidence.overflow = await page.locator('html').evaluate(
      html => {
        const content = Math.max(html.scrollWidth, html.ownerDocument.body.scrollWidth),
          fits = content <= html.clientWidth + 1;
        // Name the outermost elements that stick out, so a page-width overflow points at its cause.
        const name = e =>
          e.tagName.toLowerCase() +
          (e.id ? '#' + e.id : '') +
          (typeof e.className === 'string' && e.className.trim()
            ? '.' + e.className.trim().split(/\s+/)[0]
            : '');
        const wide = fits
          ? []
          : [...html.ownerDocument.body.querySelectorAll('*')].filter(
              e =>
                e.getBoundingClientRect().right > html.clientWidth + 1 &&
                !(
                  e.parentElement &&
                  e.parentElement !== html.ownerDocument.body &&
                  e.parentElement.getBoundingClientRect().right > html.clientWidth + 1
                )
            );
        return {
          viewport: html.clientWidth,
          content,
          fits,
          ...(wide.length
            ? {
                culprits: wide
                  .slice(0, 3)
                  .map(e => ({element: name(e), right: Math.round(e.getBoundingClientRect().right)}))
              }
            : {})
        };
      },
      undefined,
      {timeout: 1000}
    );
    // Duplicate data-af-id values in the live DOM (after any steps): comments and edits address elements by this ID.
    evidence.ids = await page.locator('html').evaluate(
      html => {
        const counts = new Map();
        for (const node of html.ownerDocument.querySelectorAll('[data-af-id]')) {
          const id = node.getAttribute('data-af-id');
          if (id) counts.set(id, (counts.get(id) || 0) + 1);
        }
        const duplicated = [...counts].filter(([, count]) => count > 1);
        return {
          total: counts.size,
          duplicates: duplicated.length,
          items: duplicated.slice(0, 5).map(([id, count]) => ({id, count}))
        };
      },
      undefined,
      {timeout: 1000}
    );
    // Text colour against its resolved solid background (WCAG ratio); agents without image input cannot see contrast.
    evidence.contrast = await page.locator('html').evaluate(
      () => {
        const parse = v => {
          const m = String(v).match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1]
            .split(/[ ,/]+/)
            .filter(Boolean)
            .map(Number);
          return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1};
        };
        const over = (top, under) => ({
          r: top.r * top.a + under.r * (1 - top.a),
          g: top.g * top.a + under.g * (1 - top.a),
          b: top.b * top.a + under.b * (1 - top.a),
          a: 1
        });
        const lum = c => {
          const f = x => {
            x /= 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const background = el => {
          const layers = [];
          for (let e = el; e; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (/url\(/.test(s.backgroundImage)) return null;
            const c = parse(s.backgroundColor);
            if (c && c.a > 0) {
              layers.push(c);
              if (c.a >= 1) break;
            }
          }
          let base = {r: 255, g: 255, b: 255, a: 1};
          for (const c of layers.reverse()) base = over(c, base);
          return base;
        };
        const seen = new Set(),
          low = [];
        let checked = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement;
          if (!el || seen.has(el) || n.textContent.trim().length < 2) continue;
          seen.add(el);
          const s = getComputedStyle(el),
            rect = el.getBoundingClientRect();
          if (
            s.visibility !== 'visible' ||
            Number(s.opacity) === 0 ||
            rect.width < 2 ||
            rect.height < 2 ||
            s.backgroundClip === 'text'
          )
            continue;
          let fg = parse(s.color);
          const bg = background(el);
          if (!fg || !bg) continue;
          if (fg.a < 1) fg = over(fg, bg);
          checked++;
          const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x),
            ratio = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
          const size = parseFloat(s.fontSize),
            need = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700) ? 3 : 4.5;
          if (ratio < need) {
            const slide = el.closest('[data-af-slide]');
            low.push({
              text: n.textContent.trim().slice(0, 48),
              ratio,
              need,
              color: s.color,
              fontSize: Math.round(size),
              element:
                el.tagName.toLowerCase() +
                (el.id ? '#' + el.id : '') +
                (typeof el.className === 'string' && el.className.trim()
                  ? '.' + el.className.trim().split(/\s+/)[0]
                  : ''),
              ...(slide ? {slide: [...document.querySelectorAll('[data-af-slide]')].indexOf(slide) + 1} : {})
            });
          }
        }
        low.sort((x, y) => x.ratio - y.ratio);
        return {
          checked,
          belowAA: low.length,
          unreadable: low.filter(item => item.ratio < 2).length,
          low: low.slice(0, 100)
        };
      },
      undefined,
      {timeout: 1500}
    );
    // Each laid-out data-af-slide at this viewport: text cut off by the slide or a clipping box inside it, and text drawn over other text.
    evidence.slides = await page.locator('html').evaluate(
      () => {
        const slides = [...document.querySelectorAll('[data-af-slide]')].filter(
          slide =>
            !slide.closest('[data-af-deck-chrome]') &&
            slide.getBoundingClientRect().width > 1 &&
            slide.getBoundingClientRect().height > 1
        );
        if (!slides.length) return null;
        const clipped = [],
          overlaps = [];
        slides.forEach((slide, index) => {
          const seen = new Set(),
            texts = [],
            walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || seen.has(el) || n.textContent.trim().length < 2 || el.closest('[data-af-deck-chrome]'))
              continue;
            seen.add(el);
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            if (s.visibility !== 'visible' || Number(s.opacity) === 0 || r.width < 1 || r.height < 1)
              continue;
            // Visually hidden text (sr-only tables, clipped boxes) is neither clipped nor overlapping; chart libraries place SVG labels.
            let hidden = false;
            for (let e = el; e && !hidden && e !== slide.parentElement; e = e.parentElement) {
              const es = getComputedStyle(e),
                er = e.getBoundingClientRect();
              hidden = es.clip !== 'auto' || es.clipPath !== 'none' || er.width < 4 || er.height < 4;
            }
            if (hidden) continue;
            if (!el.closest('svg')) texts.push({el, r, text: n.textContent.trim().slice(0, 48)});
            for (let box = el; box; box = box === slide ? null : box.parentElement) {
              const b = box.getBoundingClientRect(),
                style = getComputedStyle(box);
              if (box !== slide && style.overflowX === 'visible' && style.overflowY === 'visible') continue;
              // An HTML box clips only content that overflows it; a tall display font's glyph box poking past a hidden-overflow box is not a clip.
              if (
                box !== slide &&
                box instanceof HTMLElement &&
                box.scrollHeight <= box.clientHeight + 1 &&
                box.scrollWidth <= box.clientWidth + 1
              )
                continue;
              const by = Math.max(b.top - r.top, r.bottom - b.bottom, b.left - r.left, r.right - b.right);
              // A font's em box overhangs a tight line box without clipping visible glyphs; ignore overhang within ~15% of the font size.
              if (by > Math.max(1, 0.15 * parseFloat(s.fontSize || '16'))) {
                clipped.push({
                  slide: index + 1,
                  text: n.textContent.trim().slice(0, 48),
                  px: Math.round(by),
                  by:
                    box === slide
                      ? 'slide'
                      : box.tagName.toLowerCase() +
                        (box.className && typeof box.className === 'string'
                          ? '.' + box.className.trim().split(/\s+/)[0]
                          : '')
                });
                break;
              }
            }
          }
          // HTML text drawn over other HTML text (not nested), across at least 30% of the smaller box each way; chart libraries place SVG labels.
          for (let i = 0; i < texts.length; i++)
            for (let j = i + 1; j < texts.length; j++) {
              const a = texts[i],
                b = texts[j];
              if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
              const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left),
                h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
              if (w > 0.3 * Math.min(a.r.width, b.r.width) && h > 0.3 * Math.min(a.r.height, b.r.height))
                overlaps.push({slide: index + 1, text: a.text, over: b.text});
            }
        });
        return {
          count: slides.length,
          clipped: clipped.length,
          items: clipped.slice(0, 100),
          overlapping: overlaps.length,
          overlaps: overlaps.slice(0, 100)
        };
      },
      undefined,
      {timeout: 1500}
    );
  } catch (error) {
    evidence.inspectionError = String(error.message);
  }
  if (options.capture)
    try {
      evidence.screenshot = {
        mime: 'image/png',
        scope: options.hosted ? 'reader-viewport' : 'local-viewport',
        base64: Buffer.from(await page.screenshot({fullPage: false, timeout: 1000})).toString('base64')
      };
    } catch (error) {
      evidence.screenshotError = String(error.message);
    }
  // Do not let page-close cancellation events mutate evidence already collected.
  return {
    ...evidence,
    pageErrors: [...pageErrors],
    consoleErrors: [...consoleErrors],
    failedRequests: [...failedRequests],
    httpErrors: [...httpErrors],
    telemetry: [...telemetry]
  };
}
/**
 * The function's source without full-line comments and indentation: the session accepts 64 KB of script and the steps
 * file may take 48 KB of it, so readable source must not cost script budget. Line breaks are kept.
 */
export function compactSource(fn) {
  return fn
    .toString()
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{2,}/g, '\n');
}
export function checkScript({
  target,
  viewports,
  steps = '',
  timeoutMs = 2500,
  capture = false,
  compareReload = false
}) {
  if (!viewports || viewports.length !== 1) throw Error('Each hosted execution checks one viewport.');
  return `const page=await context.newPage();try{return await (${compactSource(inspectPage)})(page,${JSON.stringify({target, viewport: viewports[0], timeoutMs, hosted: true, capture, compareReload})},${steps ? `async(page,step)=>{${steps}\n}` : 'null'});}finally{await page.close();}`;
}
/** @returns {import('../../../lib/skills/author-toolbox-contract').AuthorCheckResult} */
// Smoke passes only without errors, overflow, unreadable text or duplicate ids; task and visual acceptance stay unverified.
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
    note: 'Smoke evidence only. Inspect task results separately; text and geometry cannot establish visual acceptance.'
  };
}
function origin(value) {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw Error('Select a server origin.');
  return url.origin;
}
/** One session, one execution per viewport, receipt-safe status polling and close. */
/** @param {any} options */
// Hosted: one server browser session per viewport, all concurrent, each polled to completion and closed.
export async function checkHosted(
  {target, viewports, steps = '', viewer, server, token = undefined, requester = undefined, capture = false},
  fetcher = fetch
) {
  server = origin(server);
  if (!token && !requester) throw Error('Supply ARTIFACTBIN_TOKEN outside page code.');
  async function request(body) {
    if (requester) return requester(body);
    // Only a status read is repeated through a restart (shared policy, lib/http/retry); a script submission is never replayed — its lost response is recovered by observing the same receipt below.
    const send = () =>
      fetcher(server + '/api/browser-sessions', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Origin: server},
        body: JSON.stringify(body)
      });
    const response =
      body.op === 'status'
        ? (await (await platform()).retryFetch(send, {method: 'POST', safeToRepeat: true})).response
        : await send();
    const result = await response.json();
    if (!response.ok) {
      const code = result.error?.code ?? result.error ?? 'unknown';
      // The server holds a few browser sessions at once; a full server is a known, retryable state, not an unexplained failure.
      if (code === 'SESSION_CAPACITY' || code === 'SESSION_ACTOR_CAPACITY')
        throw new ToolError(
          'browser_busy',
          result.error?.message ?? 'All browser sessions are in use.',
          1,
          'Run checks one at a time; wait a few seconds and retry.'
        );
      throw Error('Browser session refused (HTTP ' + response.status + '): ' + code);
    }
    return result;
  }
  // Each viewport runs in its own fresh session, concurrently: no viewer-local state leaks between viewports and the check takes the slowest viewport's time, not the sum.
  async function inspectViewport(viewport) {
    const session_id = randomUUID(),
      execution_id = randomUUID(),
      out = [];
    let accepted = false;
    try {
      const body = {
        op: 'script',
        session_id,
        execution_id,
        create: true,
        code: checkScript({
          target,
          viewports: [viewport],
          steps,
          capture,
          compareReload: viewport === viewports[0]
        }),
        ...(viewer ? {viewer} : {})
      };
      let run;
      // Creating the session waits up to ~20 s for a free browser slot before reporting browser_busy.
      const submit = async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await request(body);
          } catch (error) {
            if (error?.code !== 'browser_busy' || attempt >= 4) throw error;
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      };
      try {
        run = await submit();
        accepted = true;
      } catch (error) {
        if (error?.code === 'browser_busy') throw error;
        // A lost submission response may still have executed. Observe the same receipt; never replay actions.
        try {
          run = await request({op: 'status', session_id, execution_id});
          accepted = run.session_id === session_id;
        } catch {
          throw error;
        }
      }
      if (run.session_id !== session_id || run.execution_id !== execution_id)
        throw Error('Mismatched browser receipt.');
      for (
        const deadline = Date.now() + 25000;
        ['queued', 'running'].includes(run.status) && Date.now() < deadline;
      ) {
        await new Promise(resolve => setTimeout(resolve, 250));
        run = await request({op: 'status', session_id, execution_id});
      }
      out.push(
        run.status === 'completed'
          ? run.result
          : {viewport, error: run.error ?? run.status, session_id, execution_id, pages: run.pages}
      );
    } finally {
      if (accepted)
        try {
          await request({op: 'close', session_id});
        } catch (error) {
          out.push({error: 'Session cleanup failed: ' + error.message});
        }
    }
    return out;
  }
  const settled = await Promise.allSettled(viewports.map(inspectViewport));
  const busy = settled.find(result => result.status === 'rejected');
  if (busy) throw busy.reason;
  return summarizeCheck(settled.flatMap(result => result.value));
}
// Local: a disposable headless Chromium that can only reach the preview's own origin.
export async function checkLocal({target, viewports, steps = '', capture = false}, chromium) {
  const selected = checkTarget(target);
  if (selected.mode !== 'local') throw Error('Local checks require a loopback preview URL.');
  // launch() creates a disposable temporary profile; never attach to an existing browser or userDataDir.
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
    for (const viewport of viewports) {
      const page = await context.newPage();
      try {
        checks.push(
          await inspectPage(
            page,
            {target, viewport, capture, compareReload: viewport === viewports[0]},
            steps ? new (Object.getPrototypeOf(async function () {}).constructor)('page', 'step', steps) : null
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
// CLI entry: choose local preview or hosted page, run the viewports, save screenshots, then fail if smoke failed.
export async function checkCommand({values, positionals}, options = {}) {
  let input = positional(positionals),
    paired = null;
  const widths = values.viewport ?? ['1280x800', '390x844'];
  // A published file stands for its page: index.html reads the id and server from index.html.af.json.
  if (/\.html?$/i.test(input) && !/^https?:\/\//i.test(input)) {
    try {
      paired = JSON.parse(await readFile(input + '.af.json', 'utf8'));
    } catch {}
    if (!/^[A-Za-z0-9]{6,12}$/.test(paired?.id ?? ''))
      throw new ToolError('unpublished_file', `No published page is paired with ${input}.`, 2, `Publish it first: node scripts/publish.mjs ${input}`);
    input = paired.id;
  }
  if (widths.length > 8) throw new ToolError('viewport_limit', 'At most eight viewports are supported.', 2);
  const viewports = widths.map(value => {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match || [match[1], match[2]].some(n => Number(n) < 240 || Number(n) > 3840))
      throw new ToolError('invalid_viewport', 'Use WIDTHxHEIGHT with dimensions from 240 to 3840.', 2);
    return {width: Number(match[1]), height: Number(match[2])};
  });
  const steps = values.steps ? stepsBody(await readFile(values.steps, 'utf8')) : '';
  if (Buffer.byteLength(steps) > 48000) throw new ToolError('steps_too_large', 'Task steps exceed 48 KB.', 2);
  let result;
  const local = /^http:\/\//.test(input) && !/^\/a\/[A-Za-z0-9]{6,12}\/?$/.test(new URL(input).pathname);
  if (local) {
    if (values.viewer || values.server || values['guest-steps'] || values['cleanup-steps'])
      throw new ToolError('local_identity', 'Loopback preview has no platform viewer/server selection.', 2);
    const chromium = await loadChromium(values['playwright-module']);
    result = await checkLocal({target: checkTarget(input).target, viewports, steps, capture: true}, chromium);
    // The preview's autofix findings for this page (lib/html-autofix), listed first in the summary.
    try {
      const target = new URL(checkTarget(input).target),
        response = await fetch(
          new URL('/__af_preview/autofix?path=' + encodeURIComponent(target.pathname), target.origin),
          {signal: AbortSignal.timeout(3000)}
        );
      if (response.ok) result.autofix = await response.json();
    } catch {}
  } else {
    if (values['playwright-module'])
      throw new ToolError('hosted_browser', 'Hosted checks use server browser sessions.', 2);
    const {server, id} = resolveTarget(input, paired?.server && !values.server ? paired.server : selectedServer(values, options.env)),
      client = makeClient(server, options);
    const viewer = values.viewer ? enumValue(values.viewer, ['self', 'guest'], 'viewer') : 'self';
    if ((values['guest-steps'] || values['cleanup-steps']) && viewer === 'guest')
      throw new ToolError('guest_twice', 'Use --guest-steps and --cleanup-steps with the self viewer.', 2);
    const run = async (file, who) => {
      const found = await checkHosted({
        target: '/a/' + id,
        server,
        viewports: viewports.slice(0, 1),
        steps: stepsBody(await readFile(file, 'utf8')),
        capture: true,
        viewer: who === 'guest' ? 'guest' : undefined,
        requester: body => client.request('/api/browser-sessions', {method: 'POST', body})
      });
      for (const check of found.checks) check.viewer = who;
      return found.checks;
    };
    // Self, then --guest-steps (a second, signed-out session that reads what self saved), then
    // --cleanup-steps signed in, always, so test writes never stay behind.
    const extra = [];
    try {
      result = await checkHosted({
        target: '/a/' + id,
        server,
        viewports,
        steps,
        capture: true,
        viewer: viewer === 'guest' ? 'guest' : undefined,
        requester: body => client.request('/api/browser-sessions', {method: 'POST', body})
      });
      if (values['guest-steps']) extra.push(...(await run(values['guest-steps'], 'guest')));
    } finally {
      if (values['cleanup-steps'])
        extra.push(...(await run(values['cleanup-steps'], 'cleanup').catch(error => [{error: 'cleanup: ' + error.message}])));
    }
    if (extra.length) result = summarizeCheck([...result.checks, ...extra]);
    // A deck's slide image links for the reply.
    const count = result.checks.find(check => check?.slides?.count)?.slides.count;
    if (count)
      result.slideLinks = Array.from({length: count}, (_, n) => `${server}/a/${id}/export?format=png&slide=${n + 1}`);
  }
  const directory = path.join(credentialRoot(options.env), 'checks', randomUUID());
  let created = false;
  for (const check of result.checks) {
    if (check.screenshot) {
      if (!created) {
        await mkdir(directory, {recursive: true, mode: 0o700});
        created = true;
      }
      const file = path.join(
        directory,
        `${check.viewport.width}x${check.viewport.height}${check.viewer ? '-' + check.viewer : ''}.png`
      );
      await exclusive(file, Buffer.from(check.screenshot.base64, 'base64'));
      check.screenshot = {
        path: file,
        mime: 'image/png',
        scope: check.screenshot.scope,
        visuallyReviewed: false
      };
    }
  }
  if (!result.smokePassed)
    throw new ToolError(
      'check_failed',
      'Smoke or task checks failed.',
      1,
      'Inspect partial diagnostics and remaining unverified acceptance.',
      result
    );
  return result;
}
await runTool('check', import.meta.url, checkCommand);
