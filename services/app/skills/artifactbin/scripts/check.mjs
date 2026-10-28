/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Browser smoke and task check of a saved page or a local preview.
Reports errors, overflow, contrast, duplicate ids and your steps; appearance stays unverified.
Usage: node scripts/check.mjs ID|URL|FILE.html [--viewport WxH]... [--steps FILE]
       [--guest-steps FILE] [--cleanup-steps FILE] [--viewer self|guest] [--output FILE]
       node scripts/check.mjs http://127.0.0.1:PORT/ ...   (local preview from serve.mjs; other
         origins are blocked)
A hosted check (ID, URL or FILE.html) runs in a server browser session: never install Playwright
  or Chromium; only a local serve.mjs preview needs --playwright-module.
Flags: --viewport WIDTHxHEIGHT (repeat up to 8; default 1280x800 and 390x844; decks: 1200x630 and
  1280x800 only); --steps FILE an async function body receiving page and step (or a module whose
  export default takes page or {page}); wrap each check in await step('what it shows',
  async()=>{...}) and throw on failure; --guest-steps FILE then runs a second, signed-out session
  on the first viewport (it can read what --steps saved); --cleanup-steps FILE then runs signed
  in, always, even after a failure, to undo test writes; --viewer self (default) or guest (hosted
  only; the page is signed in as you unless guest); --playwright-module FILE (local only: your
  installed Playwright entrypoint). Common: --server ORIGIN, --json, --output FILE (use a new name
  each run), --help.
Examples:
  node scripts/check.mjs ID --viewport 1280x800 --viewport 390x844 --steps acceptance.mjs
    --output qa-1.json
  node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs
    --guest-steps guest.mjs --cleanup-steps cleanup.mjs --output qa-1.json
  steps file:  await step('Add shows Saved',async()=>{
               await page.getByRole('button',{name:'Add'}).click();
               await page.getByText('Saved').waitFor();});
  Assert rendered, rounded text ("$1,240"), not raw numbers. A passing run prints Verified: (the
  step labels, per viewport) and Not verified:; describe testing only by quoting the Verified:
  line.
Output: --output saves the full JSON and prints one summary line per viewport: errors, overflow,
  contrast (text under 2:1 fails), slides, your task result; each failing item (up to 12 of a
  kind) names its text and element or slide. Smoke fails on page or console errors, failed
  requests, overflow, unreadable text and duplicate data-af-id values (first ids and counts
  listed). A warning (not a failure) lists script-created data-af-ids that differ between two
  loads; checked on the first viewport, only when the page has any.
Gotchas: each steps file gets 8 s per viewport and 2.5 s per call, so wait for data first (also
  after page.reload()), use waitForFunction(fn,null,{timeout:4000}) and avoid networkidle.
  Script-made nodes carry data-af-id, not id: select and click them with [data-af-id="…"]
  (accessible names include CSS ::before/::after text, so use a regex name with getByRole). Vega
  bars and lines are <path>, not <rect>. Skip a no-steps smoke run. page is scoped to the page's
  own document frame (page.mainFrame() reaches the reader chrome); page.keyboard needs no click.
  innerText applies CSS text-transform and keeps newlines: collapse whitespace and match
  case-insensitively. Viewports run concurrently in fresh sessions: guard writes to one (if
  (page.viewportSize().width > 800)) and restore what you change. Past the deadline, the error
  names the numbered call still running and what the page shows. A hosted script is limited to
  20 s and 64 KB.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome. Results
  never contain credentials.`;

/** Browser check contracts. Smoke evidence never implies task or visual acceptance. The command
 * and its parts live in toolbox-check-*.mjs; this entry re-exports them. */
import {runTool} from './toolbox-client.mjs';
import {checkCommand} from './toolbox-check-command.mjs';
export {checkCommand};
export {inspectPage} from './toolbox-check-inspect.mjs';
export {checkHosted, checkLocal} from './toolbox-check-hosted.mjs';
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
