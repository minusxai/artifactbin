/**
 * Internal: check.mjs's command: choose the local preview or the hosted page, run the viewports
 * (and any guest and cleanup steps), save screenshots, then fail if smoke failed.
 * Used by: check.mjs (runTool and re-export), author-toolbox.test.ts.
 */
import {readFile, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {
  resolveTarget,
  selectedServer,
  makeClient,
  positional,
  enumValue,
  credentialRoot,
  ToolError,
  exclusive
} from './toolbox-client.mjs';
import {checkTarget, loadChromium, stepsBody, summarizeCheck} from './toolbox-check-script.mjs';
import {checkHosted, checkLocal} from './toolbox-check-hosted.mjs';

// CLI entry: choose local preview or hosted page, run the viewports, save screenshots, then fail if
// smoke failed.
export async function checkCommand({values, positionals}, options = {}) {
  let input = positional(positionals),
    paired = null;
  const widths = values.viewport ?? ['1280x800', '390x844'];
  // A published file stands for its page: index.html reads the id and server from
  // index.html.af.json.
  if (/\.html?$/i.test(input) && !/^https?:\/\//i.test(input)) {
    try {
      paired = JSON.parse(await readFile(input + '.af.json', 'utf8'));
    } catch {}
    if (!/^[A-Za-z0-9]{6,12}$/.test(paired?.id ?? ''))
      throw new ToolError(
        'unpublished_file',
        `No published page is paired with ${input}.`,
        2,
        `Publish it first: node scripts/publish.mjs ${input}`
      );
    input = paired.id;
  }
  if (widths.length > 8)
    throw new ToolError('viewport_limit', 'At most eight viewports are supported.', 2);
  const viewports = widths.map(value => {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match || [match[1], match[2]].some(n => Number(n) < 240 || Number(n) > 3840))
      throw new ToolError(
        'invalid_viewport',
        'Use WIDTHxHEIGHT with dimensions from 240 to 3840.',
        2
      );
    return {width: Number(match[1]), height: Number(match[2])};
  });
  const steps = values.steps ? stepsBody(await readFile(values.steps, 'utf8')) : '';
  if (Buffer.byteLength(steps) > 48000)
    throw new ToolError('steps_too_large', 'Task steps exceed 48 KB.', 2);
  let result;
  const local =
    /^http:\/\//.test(input) && !/^\/a\/[A-Za-z0-9]{6,12}\/?$/.test(new URL(input).pathname);
  if (local) {
    if (values.viewer || values.server || values['guest-steps'] || values['cleanup-steps'])
      throw new ToolError(
        'local_identity',
        'Loopback preview has no platform viewer/server selection.',
        2
      );
    const chromium = await loadChromium(values['playwright-module']);
    result = await checkLocal(
      {target: checkTarget(input).target, viewports, steps, capture: true},
      chromium
    );
    // The preview's autofix findings for this page (lib/html-autofix), listed first in the summary.
    try {
      const target = new URL(checkTarget(input).target),
        response = await fetch(
          new URL(
            '/__af_preview/autofix?path=' + encodeURIComponent(target.pathname),
            target.origin
          ),
          {signal: AbortSignal.timeout(3000)}
        );
      if (response.ok) result.autofix = await response.json();
    } catch {}
  } else {
    if (values['playwright-module'])
      throw new ToolError('hosted_browser', 'Hosted checks use server browser sessions.', 2);
    const {server, id} = resolveTarget(
        input,
        paired?.server && !values.server ? paired.server : selectedServer(values, options.env)
      ),
      client = makeClient(server, options);
    const viewer = values.viewer ? enumValue(values.viewer, ['self', 'guest'], 'viewer') : 'self';
    if ((values['guest-steps'] || values['cleanup-steps']) && viewer === 'guest')
      throw new ToolError(
        'guest_twice',
        'Use --guest-steps and --cleanup-steps with the self viewer.',
        2
      );
    const requester = body => client.request('/api/browser-sessions', {method: 'POST', body});
    // Warm up: plain reads of the page and its linked datasets first, so the first hosted run
    // does not meet a cold start. Never fails the check; capped at 5 s.
    await Promise.race([
      (async () => {
        const html = await (await client.request(`/a/${id}/raw`, {raw: true})).text();
        const refs = [...html.matchAll(/<link\b[^>]*\baf-dataset\b[^>]*>/g)].flatMap(
          ([tag]) => tag.match(/href="ref:([A-Za-z0-9]+)"/)?.slice(1) ?? []
        );
        await Promise.allSettled(refs.map(ref => client.request('/api/artifacts/' + ref)));
      })().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 5000).unref?.())
    ]);
    const run = async (file, who) => {
      const found = await checkHosted({
        target: '/a/' + id,
        server,
        viewports: viewports.slice(0, 1),
        steps: stepsBody(await readFile(file, 'utf8')),
        capture: true,
        viewer: who === 'guest' ? 'guest' : undefined,
        requester
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
        requester
      });
      if (values['guest-steps']) extra.push(...(await run(values['guest-steps'], 'guest')));
    } finally {
      if (values['cleanup-steps'])
        extra.push(
          ...(await run(values['cleanup-steps'], 'cleanup').catch(error => [
            {error: 'cleanup: ' + error.message}
          ]))
        );
    }
    if (extra.length) result = summarizeCheck([...result.checks, ...extra]);
    // A deck's slide image links for the reply.
    const count = result.checks.find(check => check?.slides?.count)?.slides.count;
    if (count)
      result.slideLinks = Array.from(
        {length: count},
        (_, n) => `${server}/a/${id}/export?format=png&slide=${n + 1}`
      );
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
        `${check.viewport.width}x${check.viewport.height}` +
          `${check.viewer ? '-' + check.viewer : ''}.png`
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
