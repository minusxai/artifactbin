/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Publish a page, dataset or asset with its local dependencies.
FILE and FILE.af.json are rewritten in place with the canonical result.
Usage: node scripts/publish.mjs FILE [--title T] [--visibility private|unlisted|public]
         [--group HANDLE | --personal] [--dry-run] [--strict]
       node scripts/publish.mjs FILE --artifact ID
       node scripts/publish.mjs --resume JOURNAL
Flags: --artifact ID replaces that existing page with FILE: its companion FILE.af.json is the
  baseline when it belongs to ID, otherwise the page's current version is (a starter copied
  over a page, an overwritten or companionless file); --type html|dataset|asset (inferred from
  unambiguous extensions); --root DIR project boundary (default: the source directory);
  --manifest FILE JSON {"manifest":[paths]} of extra runtime-loaded files; --title;
  --visibility (new pages default to unlisted); --template read-only|own-rows|editors-only
  [--owner-column C] a new dataset's permissions (prints readBack); --name NAME a new dataset's
  GraphQL root (default: from the title; fixed once created); --group HANDLE creates a new page
  in that group (you need editor access; it resolves GET /api/groups/HANDLE first); a destination
  that conflicts with the parent's owner is refused, and it never moves existing pages, so
  updates reject it; --dry-run validates and plans without writes; --strict refuses fixable
  autofix problems instead of fixing them; --create publishes FILE as a new page even when it
  came from another one; --request FILE exclusive journal outside the project; --resume JOURNAL.
  --personal creates personally owned work even with a default group. Omit both destination
  flags to use your account default. Neither flag moves existing pages.
  Common: --server ORIGIN, --json, --output FILE, --help.
Examples:
  node scripts/publish.mjs ./project/index.html           # first publish; prints the receipt and
                                                            any autofix: changes
  node scripts/publish.mjs index.html --artifact ID       # index.html replaces page ID
  node scripts/publish.mjs page.html --group design_team  # new page in a group you edit
  node scripts/publish.mjs signups.csv --template own-rows --owner-column created_by
  node scripts/publish.mjs page.html                      # after: node scripts/read.mjs ID
                                                            --output page.html
  node scripts/publish.mjs --resume JOURNAL               # after exit 5 (unknown outcome);
                                                            replays the exact request
Gotchas: publish adds data-af-id attributes to FILE, so exact-text edits written against the old
  text miss: re-read FILE after publishing or edit by element. A new page needs no data-af-id:
  ones you wrote are dropped (a routine autofix note) and a repeated one is renumbered. An empty
  page and starter placeholders left in it (a ref: link with no real ID, a starter's [bracketed]
  text) are refused with the line to fix. Keep editing and publishing the same file (never copy
  or hand-edit the .af.json companion). Dependencies publish before the page and are discovered
  from static HTML URLs, CSS url() and @import, and static or literal dynamic module imports (up
  to 99 files, 4 MB each, 16 MB total); list other runtime-loaded files in --manifest. Computed
  imports and cyclic graphs are refused; remote URLs, absolute server paths and ref: links stay
  as written. af-resolver files go in as resolver sources, never as public assets. An update is
  conditional on the version its baseline saw: a concurrent remote change exits 4 instead of
  overwriting; then run read.mjs ID --output page.html, reapply your edits there and publish
  it. The journal is saved before sending and --resume never changes it. Data and media identity
  lives only in the .af.json companion.
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
