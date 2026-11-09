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
import {checkHosted} from './toolbox-check-hosted.mjs';
import {sourceIdentity} from './toolbox-source.mjs';
import {checkLocal} from './toolbox-check-local.mjs';
import {explainGraphql} from './toolbox-check-resolvers.mjs';
import {DECK_VIEWPORTS, PAGE_VIEWPORTS, isDeck, pageSource, replyFacts, unreadDatasets}
  from './toolbox-check-reply.mjs';

// CLI entry: choose local preview or hosted page, run the viewports, save screenshots, then fail if
// smoke failed.
export async function checkCommand({values, positionals}, options = {}) {
  let input = positional(positionals),
    marker = null;
  // A published file stands for its page: its af-authoring marker names the page and server.
  if (/\.html?$/i.test(input) && !/^https?:\/\//i.test(input)) {
    marker = sourceIdentity(await readFile(input, 'utf8').catch(() => ''));
    if (!/^[A-Za-z0-9]{6,12}$/.test(marker?.id ?? ''))
      throw new ToolError(
        'unpublished_file',
        `${input} names no published page (it has no af-authoring marker).`,
        2,
        `Publish it first: node scripts/publish.mjs ${input} --create`
      );
    input = marker.id;
  }
  if ((values.viewport?.length ?? 0) > 8)
    throw new ToolError('viewport_limit', 'At most eight viewports are supported.', 2);
  // Without --viewport a deck gets the deck sizes and any other page desktop and phone.
  const sized = html => (values.viewport ?? (isDeck(html) ? DECK_VIEWPORTS : PAGE_VIEWPORTS))
    .map(value => {
      const match = /^(\d+)x(\d+)$/.exec(value);
      if (!match || [match[1], match[2]].some(n => Number(n) < 240 || Number(n) > 3840))
        throw new ToolError(
          'invalid_viewport',
          'Use WIDTHxHEIGHT with dimensions from 240 to 3840.',
          2
        );
      return {width: Number(match[1]), height: Number(match[2])};
    });
  sized('');
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
    const html = await fetch(checkTarget(input).target, {signal: AbortSignal.timeout(3000)})
      .then(response => response.text()).catch(() => '');
    result = await checkLocal(
      {target: checkTarget(input).target, viewports: sized(html), steps, capture: true,
        slides: true},
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
        marker?.server && !values.server ? marker.server : selectedServer(values, options.env)
      ),
      client = makeClient(server, options);
    const viewer = values.viewer ? enumValue(values.viewer, ['self', 'guest'], 'viewer') : 'self';
    if ((values['guest-steps'] || values['cleanup-steps']) && viewer === 'guest')
      throw new ToolError(
        'guest_twice',
        'Use --guest-steps and --cleanup-steps with the self viewer.',
        2
      );
    // A status read is safe to repeat through a restart; a script submission never is.
    const requester = body => client.request('/api/browser-sessions',
      {method: 'POST', body, safeToRepeat: body.op === 'status'});
    // The page source first: it picks deck viewports and warms the linked datasets (5 s cap).
    const html = await pageSource(client, id), viewports = sized(html);
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
        slides: true,
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
    // Failed GraphQL fields get the owner detail; what only an unset resolver secret blocked is
    // Not tested, not failed.
    const checks = [...result.checks, ...extra];
    const found = await explainGraphql(client, id, checks, viewer === 'guest');
    result = Object.assign(summarizeCheck(checks), found);
    // A field that failed for the owner is a fault even unnoticed; a guest's is a refusal.
    if (found.graphqlFailures?.some(failure => !failure.guest)) result.smokePassed = false;
    // A linked dataset the page never reads means its numbers are hand-typed: not a pass.
    const unread = unreadDatasets(html, result.checks);
    if (unread.length) Object.assign(result, {smokePassed: false, unreadDatasets: unread});
    // A clean pass ends on the reply facts; those beyond the run come from the page.
    if (result.smokePassed) result.reply = await replyFacts(client, server, id, html);
    // A deck's slide image links for the reply.
    const count = result.checks.find(check => check?.slides?.count)?.slides.count;
    if (count)
      result.slideLinks = Array.from(
        {length: count},
        (_, n) => `${server}/a/${id}/export?format=png&slide=${n + 1}`
      );
  }
  // Each screenshot, and a deck's slides beside it, saved as files; the result keeps the paths.
  const directory = path.join(credentialRoot(options.env), 'checks', randomUUID());
  const save = async (name, base64) => {
    await mkdir(directory, {recursive: true, mode: 0o700});
    const file = path.join(directory, name + '.png');
    await exclusive(file, Buffer.from(base64, 'base64'));
    return file;
  };
  for (const check of result.checks) {
    if (!check.screenshot) continue;
    const {width, height} = check.viewport,
      name = `${width}x${height}${check.viewer ? '-' + check.viewer : ''}`;
    const {base64, slides, ...shot} = check.screenshot;
    check.screenshot = {path: await save(name, base64), ...shot, visuallyReviewed: false};
    if (slides)
      check.screenshot.slides = await Promise.all(slides.map(async ({base64, ...size}, n) =>
        ({path: await save(`${name}-slide-${n + 1}`, base64), ...size})));
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
