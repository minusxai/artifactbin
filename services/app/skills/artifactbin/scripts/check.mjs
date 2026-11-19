/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Browser smoke and task check of a saved page, a local preview or an
unpublished draft (never its appearance).
Usage: node scripts/check.mjs ID|URL|FILE.html [--steps FILE] [--viewport WxH]...
       [--guest-steps FILE] [--cleanup-steps FILE] [--viewer self|guest] [--output FILE]
       node scripts/check.mjs http://127.0.0.1:PORT/ ...  (serve.mjs preview; other origins blocked)
       node scripts/check.mjs FILE.html --draft  (unpublished; once at 1280x800, no steps)
All but a preview run in the server's browser: never install Playwright or Chromium. A busy
  server browser is waited out (bounded); a browser_busy after that ran nothing: rerun once your
  other checks finish.
Flags: --viewport WxH (up to 8; default 1280x800 and 390x844, a [data-af-slide] deck 1200x630 and
  1280x800); --steps FILE: an async function body given page and step (or a module whose default
  export takes page or {page}, or is an array of step calls); wrap each check in
  await step('what it shows', async()=>{...}) and throw on failure; --guest-steps FILE: then a
  signed-out session on the first viewport (it reads what --steps saved; omit for a private page);
  --cleanup-steps FILE: then signed in, always, to undo test writes; --viewer self|guest (hosted);
  --playwright-module FILE (preview only). Common: --server ORIGIN, --json, --output FILE (the
  full JSON too; a new name each run), --help.
Examples:
  node scripts/check.mjs index.html --steps steps.mjs
  node scripts/check.mjs index.html --steps s.mjs --guest-steps g.mjs --cleanup-steps c.mjs
  steps file:  await step('Add shows Saved',async()=>{
               await page.getByRole('button',{name:'Add'}).click();
               await page.getByText('Saved').waitFor();});
  Assert rendered, rounded text ("$1,240"), not raw numbers.
Output: a line per viewport, each failure (up to 12 of a kind) by text and element or slide; the
  screenshots, and for a deck one PNG per slide (up to 20): these files are the slides. Smoke
  fails on page or console errors, failed requests, overflow, text under 2:1 and duplicate
  data-af-ids; script-made data-af-ids differing between two loads are a warning. A clean pass of
  a published page ends with the facts for your reply (link, Built with, Tested, Not tested,
  who can do what in each dataset, slide images) and the Next line. A failed sql statement is
  named with its detail (a guest's read is asked again as you).
Gotchas: a steps file gets 8 s per viewport, a call without its own timeout 2.5 s: wait for data
  first (also after page.reload()) with an explicit timeout (6000 data, 5000 save, 2000 click); no
  networkidle. Script-made nodes have data-af-id, not id: select them by [data-af-id="…"];
  accessible names include CSS ::before/::after text (getByRole with a regex name). Vega marks
  are <path>, not <rect>. page is the document's frame (page.mainFrame() the reader chrome);
  page.keyboard needs no click. innerText applies text-transform and keeps newlines: collapse
  whitespace, match case-insensitively. Viewports run at once in fresh sessions: a writing step
  runs only where page.viewportSize().width > 800 and restores what it changes. Past the deadline
  the error names the call still running and what the page shows. A hosted script: 20 s, 64 KB.
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
