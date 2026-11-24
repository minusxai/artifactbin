/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Publish HTML, datasets or assets with local dependencies.
Usage: node scripts/publish.mjs FILE --create [--group GROUP|--personal] [--parent FOLDER]
       node scripts/publish.mjs FILE [--artifact ID]
       node scripts/publish.mjs --resume JOURNAL
Flags: --create creates new work; HTML marked for this server instead needs an update.
  --artifact ID replaces its current head. --type html|dataset|asset (or inferred), or connection
  with --secret-file FILE (- reads stdin).
  --root DIR: project boundary (default source directory/marker root); --title T;
  --visibility private|unlisted|public (new work defaults unlisted).
  --template read-only|own-rows|editors-only [--owner-column C] sets new dataset permissions
  (prints readBack). --group GROUP: Members publish new HTML pages, Admins anything;
  --personal overrides the default group.
  Omit both for account default. --parent FOLDER accepts an ID or
  same-origin /a/ID URL for new work; conflicting ownership is refused.
  Updates preserve filing/owner and reject destination/parent flags; connections reject parent.
  --dry-run: no writes; --strict: refuse autofix; --request FILE: exclusive journal outside project.
  --resume JOURNAL: replay unchanged after exit 5.
  Common: --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/publish.mjs page.html --create --group design_team --parent FOLD12
  node scripts/publish.mjs page.html
Gotchas: re-read rewritten HTML before editing; keep its version marker or use --artifact.
  Empty pages/placeholders fail. Static HTML/CSS/import/fetch
  dependencies publish together (99 files, 4 MB each, 16 MB total). A changed linked CSV is
  refused if the dataset was written since; local HTML gets data-af-id.
  Computed imports/cycles fail; remote/absolute/ref: URLs remain. Resolve conflicts by reading
  latest and reapplying edits. Datasets/assets need --artifact to update; otherwise they create.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Eligible HTML returns user_page_url; results omit credentials.`;

/** Optional author-skill helper. Credentials never enter a page or saved publication request. */
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {runTool} = await import('./toolbox-client.mjs');
  const {publishCommand} = await import('./toolbox-publish.mjs');
  await runTool('publish', import.meta.url, publishCommand);
}
