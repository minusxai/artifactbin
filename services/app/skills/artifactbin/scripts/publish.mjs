/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Publish a page, dataset or asset with its local dependencies.
A page's last line, <!-- af-authoring:… -->, names the page and the version it replaces; publish
rewrites FILE in place with the canonical result and a new marker. Nothing is written beside it.
Usage: node scripts/publish.mjs FILE --create [--title T] [--visibility private|unlisted|public]
         [--group HANDLE | --personal] [--dry-run] [--strict]
       node scripts/publish.mjs FILE              (a page carrying its marker)
       node scripts/publish.mjs FILE --artifact ID
       node scripts/publish.mjs --resume JOURNAL
Flags: --create publishes FILE as a new page, dataset or asset (a page without a marker needs
  it; a page that already carries this server's marker is refused: it updates that page);
  --artifact ID replaces that existing page, dataset or file with FILE over its current version
  (a starter copied over a page, a page rewritten whole, or any data file); --type
  html|dataset|asset (inferred from unambiguous extensions); --root DIR project boundary
  (default: the source directory, or where its marker says it was published from); --title;
  --visibility (new pages default to unlisted); --template read-only|own-rows|editors-only
  [--owner-column C] a new dataset's permissions (prints readBack); --name NAME a new dataset's name
  (default: the file's name, sales.csv → sales; fixed once created); --group HANDLE creates a
  new page in that group (you need editor access; it resolves GET /api/groups/HANDLE first); a
  destination that conflicts with the parent's owner is refused, and it never moves existing
  pages, so updates reject it; --dry-run validates and plans without writes; --strict refuses
  fixable autofix problems instead of fixing them; --request FILE exclusive journal outside the
  project; --resume JOURNAL. --personal creates personally owned work even with a default
  group. Omit both destination flags to use your account default. Neither flag moves existing
  pages. Common: --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/publish.mjs ./project/index.html --create  # first publish; prints the receipt
                                                            and any autofix: changes
  node scripts/publish.mjs index.html                     # every later publish of that file
  node scripts/publish.mjs index.html --artifact ID       # index.html replaces page ID
  node scripts/publish.mjs page.html --create --group design_team  # new page in a group
  node scripts/publish.mjs signups.csv --template own-rows --owner-column created_by
  node scripts/publish.mjs --resume JOURNAL               # after exit 5 (unknown outcome);
                                                            replays the exact request
Gotchas: publish adds data-af-id attributes to FILE, so exact-text edits written against the old
  text miss: re-read FILE after publishing or edit by element. A new page needs no data-af-id:
  ones you wrote are dropped (a routine autofix note) and a repeated one is renumbered. An empty
  page and starter placeholders left in it (a ref: link with no real ID, a starter's [bracketed]
  text) are refused with the line to fix. Keep editing and publishing the same file and keep its
  marker line: a page rewritten whole loses it and is refused (publish it with --artifact ID).
  Dependencies publish with the page and are discovered from static HTML URLs (<a href> too),
  CSS url() and @import, static or literal dynamic module imports, and a script's fetch of a
  literal path, fetch('./data.json'), which reads it wherever the page is read (up to 99
  files, 4 MB each, 16 MB total). A CSV linked by its path (<link rel="af-dataset"
  data-af-name="sales" href="./sales.csv">) becomes a dataset named by the file, and a later
  publish after it changes updates that same dataset. Computed imports and cyclic graphs are
  refused; remote URLs, absolute server paths and ref: links stay as written. An update is
  conditional on the version its marker saw: a newer version (exit 4) is never overwritten;
  then run read.mjs ID --output page.html, reapply your edits there and publish it. The
  journal is saved before sending and --resume never changes it. A dataset or file keeps no
  local record: its result's next names the update command (--artifact ID); without it a new
  one is created.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome. Results
  include user_page_url for eligible public/unlisted HTML when anonymous publishing hosts
  are enabled.
  Results never contain credentials.`;

/** Optional author-skill helper. Credentials never enter a page or saved publication request. */
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {runTool} = await import('./toolbox-client.mjs');
  const {publishCommand} = await import('./toolbox-publish.mjs');
  await runTool('publish', import.meta.url, publishCommand);
}
