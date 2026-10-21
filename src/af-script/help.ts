/** Each script's `--help`: exactly the text blocks in skills/pagegi-author/references/scripts.md. */
import type { AfScriptName } from "./af-contracts.ts";

export const HELP: Record<AfScriptName, string> = {
  add: `Usage: node scripts/add.mjs <file>... [--json]

Give files an ID before you reference them. Prints one line per file:
its path, then its ID. Publishing keeps the same ID. A path that
already has an ID in .af/ids.json keeps it. Sign in first with
auth.mjs, or set AF_TOKEN; uses AF_SERVER (default
https://pagegi.artifactbin.dev).

Flags
  --json   print machine-readable output
  --help   show this help

Exit codes
  0 done                                   1 .af/ids.json is not valid JSON
  2 usage, missing file, token or server   3 the server refused or did not answer

Example
  node scripts/add.mjs backends/billing.ts backends/stats.ts
`,
  check: `Usage: node scripts/check.mjs <page.html> [--write-ids] [--json]

Report problems an agent can introduce, with line numbers: the core
tag missing or not first in <head>, invalid JSON in the metadata
block, duplicate data-af-id values, backend links without a unique
data-af-name, and CDN scripts or styles without an exact version.
Exits 1 if any are found. Also warns about an import map of your own
(a warning alone exits 0).

Flags
  --write-ids   first give every element in the HTML a data-af-id, the
                same way the platform does on save, and print each new
                one. Existing IDs are kept; removed ones are never reused.
  --json        print machine-readable output
  --help        show this help

Examples
  node scripts/check.mjs page.html
  node scripts/check.mjs page.html --write-ids
`,
  shot: `Usage: node scripts/shot.mjs <page.html> [flags]

Open the page in Chrome with the live core and save a screenshot, to
check the layout and dark mode by eye.

Flags
  --width <px>             viewport width (default 1280; use 390 for phones)
  --dark                   show the page in dark mode
  --design-system <name>   show this design system (default: the
                           page's own, or meridian)
  --out <file.png>         output path (default shot.png)
  --state <file.json>      open the page with this local state, to
                           screenshot a specific view
  --help                   show this help

Example
  node scripts/shot.mjs page.html --width 390 --dark --out phone-dark.png
`,
  publish: `Usage: node scripts/publish.mjs <page.html> [flags]

Publish a new page, or save your changes to a published one. On
success the file is replaced with the page as the server saved it.
If someone else saved first, their changes are merged into the file
for you to review, or, if they overlap with yours, the latest version
is written to <page>.remote.html and both sides' changes to
<page>.conflict.diff. Keep the .af/ folder next to the page. Sign in
first with auth.mjs, or set AF_TOKEN; uses AF_SERVER (default
https://pagegi.artifactbin.dev).

Flags
  --pull          replace the file with the published page (a changed
                  local copy is backed up in .af/backups/ first)
  --new           publish the file as a new page of your own
  --force         save over the published page even if it changed
                  (the published version is backed up in .af/backups/)
  --delete --yes  delete the published page (owner only)
  --json          print machine-readable output
  --help          show this help

Exit codes
  0 done                      1 refused, or merged for you to review
  2 usage, token or server    3 server error: nothing saved, run it again later
  4 conflict                  5 no answer: run the same command again

Examples
  node scripts/publish.mjs page.html
  node scripts/publish.mjs page.html --pull
`,
  comments: `Usage: node scripts/comments.mjs <page.html | page ID> [flags]

List a page's comment threads, see what a commenter saw, reply,
comment, resolve, or watch for new comments. Sign in first with
auth.mjs, or set AF_TOKEN; uses AF_SERVER (default
https://pagegi.artifactbin.dev).

Flags
  --context <comment>             save the page and state as the
                                  commenter saw them, and print their
                                  paths and an address that opens it
  --reply <comment> --body <text> reply to a comment
  --on <data-af-id> --body <text> comment on an element (add
                                  --quote <text> to quote it)
  --edit <comment> --body <text>  change a comment's text
  --resolve <comment>             resolve a thread (--reopen undoes it)
  --watch                         print each new comment, reply and
                                  change as it happens, one per line
  --json                          print machine-readable output (one
                                  JSON object per line with --watch)
  --help                          show this help

Exit codes
  0 done   1 refused   2 usage, token or server   3 server error
  4 the comment changed since you read it   5 no answer: run it again

Examples
  node scripts/comments.mjs page.html
  node scripts/comments.mjs page.html --reply c1 --body "Fixed."
`,
  auth: `Usage: node scripts/auth.mjs [flags]

Sign in to AF_SERVER (default https://pagegi.artifactbin.dev) and save the
token for add.mjs, publish.mjs and comments.mjs. With no flags, list
each saved server, its account, and whether its token still works.

Flags
  --email <address>                email a sign-in code to the address
  --email <address> --code <code>  sign in with the code from the email
  --logout                         remove the saved token for AF_SERVER
  --test-token --email <address>   sign in without a code, on a
                                   development server that allows it
  --json                           print machine-readable output
  --help                           show this help

Tokens are saved in ~/.af/credentials.json (AF_HOME sets the folder).
The other scripts use AF_TOKEN when it is set, else the saved token
for AF_SERVER.

Exit codes
  0 done, or signed in   1 refused, or not signed in
  2 usage or server      3 server error or no answer

Examples
  node scripts/auth.mjs --email you@example.com
  node scripts/auth.mjs --email you@example.com --code 123456
  node scripts/auth.mjs
`,
  secrets: `Usage: node scripts/secrets.mjs [set <NAME> | remove <NAME>] [--json]

Manage the account secrets that backend lambdas you own read as env.
With no command, list each secret's name and when it was last set;
values are never shown. Sign in first with auth.mjs, or set AF_TOKEN;
uses AF_SERVER (default https://pagegi.artifactbin.dev).

Commands
  set <NAME>      store a secret, reading its value from standard
                  input (one trailing newline is dropped); a secret
                  with that name is replaced
  remove <NAME>   remove a secret

Names are a capital letter, then up to 63 capitals, digits and
underscores, like STRIPE_KEY. Values are 1 to 4096 bytes of
text without NUL.

Flags
  --json   print machine-readable output
  --help   show this help

Exit codes
  0 done   1 refused   2 usage or token   3 server error or no answer

Examples
  printf '%s' "$STRIPE_KEY" | node scripts/secrets.mjs set STRIPE_KEY
  node scripts/secrets.mjs
  node scripts/secrets.mjs remove STRIPE_KEY
`,
};
