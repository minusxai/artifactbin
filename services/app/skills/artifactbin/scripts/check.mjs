/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Browser smoke and task check of a saved page or a local preview.
Reports errors, overflow, contrast, duplicate ids and your steps; appearance stays unverified.
Usage: node scripts/check.mjs ID|URL|FILE.html [--steps FILE] [--viewport WxH]...
       [--guest-steps FILE] [--cleanup-steps FILE] [--viewer self|guest] [--output FILE]
       node scripts/check.mjs http://127.0.0.1:PORT/ ...   (local preview from serve.mjs; other
         origins are blocked)
A hosted check (ID, URL or FILE.html) runs in a server browser session: never install Playwright
  or Chromium; only a local serve.mjs preview needs --playwright-module. A busy or refusing
  server browser is waited for and retried by the check itself (bounded); a browser_busy after
  that never ran your steps: rerun the same check once your other checks finish.
Flags: --viewport WIDTHxHEIGHT (repeat up to 8; default 1280x800 and 390x844; a page with
  [data-af-slide] gets 1200x630 and 1280x800); --steps FILE an async function body receiving page
  and step (or a module whose export default takes page or {page}, or is an array of step
  calls, run in order); wrap each check in await step('what it shows', async()=>{...}) and throw
  on failure; --guest-steps FILE then runs a second, signed-out session on the first viewport
  (it can read what --steps saved; leave it out for a private page, which answers it not found);
  --cleanup-steps FILE then runs signed in, always, even after a failure, to undo test writes;
  --viewer self (default) or guest (hosted only; the page is signed in as you unless guest);
  --playwright-module FILE (local only: your installed Playwright entrypoint). Common: --server
  ORIGIN, --json, --output FILE (also saves the full JSON; use a new name each run), --help.
Examples:
  node scripts/check.mjs index.html --steps steps.mjs
  node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs
    --guest-steps guest.mjs --cleanup-steps cleanup.mjs
  steps file:  await step('Add shows Saved',async()=>{
               await page.getByRole('button',{name:'Add'}).click();
               await page.getByText('Saved').waitFor();});
  Assert rendered, rounded text ("$1,240"), not raw numbers.
Output: one summary line per viewport: errors, overflow, contrast (text under 2:1 fails), slides,
  your task result; each failing item (up to 12 of a kind) names its text and element or slide;
  then the full-page screenshots and, for a deck, one PNG per slide (up to 20) at the first
  viewport: these files are the slides. Smoke fails on page or console errors, failed requests,
  overflow, unreadable text and duplicate data-af-id values (first ids and counts listed). A
  warning (not a failure) lists script-created data-af-ids that differ between two loads; checked
  on the first viewport, only when the page has any. A clean pass of a published page ends with
  the facts for your reply (the link, Built with, Tested: from your step labels, Not tested:, who
  can do what in each linked dataset, slide images) and the Next line. A failed sql statement or
  function call (/fn/NAME) is named with the owner-only detail (a guest's read is asked again as
  you). What failed only because a secret has no value yet is
  listed as Not tested (the owner sets it in the page's Resolvers settings), not failed.
Gotchas: each steps file gets 8 s per viewport, and a call without its own timeout 2.5 s: wait
  for data first (also after page.reload()) with an explicit timeout, as the starters' steps do
  (6000 for data, 5000 for a save, 2000 for a click), and avoid networkidle.
  Script-made nodes carry data-af-id, not id: select and click them with [data-af-id="…"]
  (accessible names include CSS ::before/::after text, so use a regex name with getByRole). Vega
  bars and lines are <path>, not <rect>. page is scoped to the page's
  own document frame (page.mainFrame() reaches the reader chrome); page.keyboard needs no click.
  innerText applies CSS text-transform and keeps newlines: collapse whitespace and match
  case-insensitively. Viewports run concurrently in fresh sessions: a step that writes runs
  only where (page.viewportSize().width > 800) holds, and restores what it changes. Past the
  deadline, the error names the numbered call still running and what the page shows. A hosted
  script is limited to 20 s and 64 KB.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome. Results
  never contain credentials.`;

/** Browser check contracts. Smoke evidence never implies task or visual acceptance. The command
 * and its parts live in toolbox-check-*.mjs; this entry re-exports them. */
import {runTool} from './toolbox-client.mjs';
import {checkCommand} from './toolbox-check-command.mjs';
export {checkCommand};
export {inspectPage} from './toolbox-check-inspect.mjs';
export {checkHosted} from './toolbox-check-hosted.mjs';
export {checkLocal} from './toolbox-check-local.mjs';
export {
  loadChromium,
  checkTarget,
  stepsBody,
  compactSource,
  inspectSource,
  checkScript,
  summarizeCheck
} from './toolbox-check-script.mjs';

await runTool('check', import.meta.url, checkCommand);
