# Scripts

Seven scripts for working on a page, each doing one job. They need Node.js 20.10+ and nothing to install, and run from any folder. `scripts/lib/` holds code they share.

- `auth.mjs` signs you in and saves your token.
- `add.mjs`, `publish.mjs`, `comments.mjs` and `secrets.mjs` talk to the server at `AF_SERVER` (default `https://app.artefactbin.dev`), with `AF_TOKEN` from your environment or else the token `auth.mjs` saved.
- `check.mjs` works offline.
- `shot.mjs` needs Chrome or Chromium (set `CHROME_PATH` if it isn't found) and loads the core from `AF_SERVER`. If that server can't be reached it says so and shows only the page's static content.

## auth.mjs

```text
Usage: node scripts/auth.mjs [flags]

Sign in to AF_SERVER (default https://app.artefactbin.dev) and save the
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
```

Sign in once per server. The code arrives by email:

```text
$ node scripts/auth.mjs --email you@example.com
Sent a sign-in code to you@example.com. Run node scripts/auth.mjs --email you@example.com --code <code> with the code from the email.
$ node scripts/auth.mjs --email you@example.com --code 123456
Signed in to https://app.artefactbin.dev as you@example.com. The token is saved in /home/you/.af/credentials.json.
$ node scripts/auth.mjs
https://app.artefactbin.dev (current): signed in as you@example.com.
```

The token is saved in `~/.af/credentials.json` (in the `AF_HOME` folder when that is set), under the server's address. Only you can read the file. It is not the `.af/` folder next to a page.

```json
{ "https://app.artefactbin.dev": { "token": "…", "email": "you@example.com", "savedAt": "2026-10-21T10:00:00.000Z" } }
```

`add.mjs`, `publish.mjs`, `comments.mjs` and `secrets.mjs` pick their token in this order:

1. `AF_TOKEN`, if it is set.
2. Else the saved token for `AF_SERVER` (default `https://app.artefactbin.dev`).
3. Else they stop with exit code 2 and tell you to run `auth.mjs`.

If the server refuses the token (it expired or was revoked), the script stops with exit code 2 and asks you to sign in again, and `auth.mjs` with no flags shows that server as signed out. `--logout` forgets the saved token for `AF_SERVER`; it does not touch `AF_TOKEN`. No script prints a token or writes one into a page or the `.af/` folder.

`--test-token` only works on development servers started with `PAGEGI_TEST_LOGIN=1`; other servers answer 404.

With `--json` it prints one object, `{ status, server, email, file, message }`, never the token. `status` is `sent`, `signed-in`, `signed-out`, `status` or `error`; `email` is the account, or the address you gave with `--email`, also on an error. The status also lists `servers`, each with `server`, `email`, `source` (`AF_TOKEN` or `credentials`), `current`, `state` (`signed-in`, `signed-out` or `unknown`) and `detail`.

## The .af/ folder

`add.mjs`, `publish.mjs` and `comments.mjs` keep a small record in `.af/`, next to the page. Keep it with the page and never edit it: it is what lets the scripts merge someone else's changes and retry safely.

- `ids.json`: the IDs `add.mjs` reserved, and each one's file.
- `base/`: each page (and backend file) exactly as the server last saved it.
- `journal/`: a request whose outcome isn't known yet. A rerun resends it with the same key.
- `conflict/`: a conflict you haven't resolved yet.
- `backups/`: anything `--pull` or `--force` replaced.
- `comments/`, `context/`: what `comments.mjs` has shown you, and pages as commenters saw them.

## add.mjs

```text
Usage: node scripts/add.mjs <file>... [--json]

Give files an ID before you reference them. Prints one line per file:
its path, then its ID. Publishing keeps the same ID. A path that
already has an ID in .af/ids.json keeps it. Sign in first with
auth.mjs, or set AF_TOKEN; uses AF_SERVER (default
https://app.artefactbin.dev).

Flags
  --json   print machine-readable output
  --help   show this help

Exit codes
  0 done                                   1 .af/ids.json is not valid JSON
  2 usage, missing file, token or server   3 the server refused or did not answer

Example
  node scripts/add.mjs backends/billing.ts backends/stats.ts
```

Use the ID in the backend file's link address, for example `https://app.artefactbin.dev/af/v1/ids/Bk7Qa2`:

```text
$ node scripts/add.mjs backends/billing.ts backends/stats.ts
backends/billing.ts  Bk7Qa2
backends/stats.ts    Cr4mZ9
```

Run it in the page's folder: it records each ID in `.af/ids.json`, which is how `publish.mjs` finds the file to send. A path that already has an ID there keeps it (the script prints the ID again and says so on stderr), and a path that doesn't exist is refused with exit code 2 before anything is reserved.

If the server answers 404 to the API, it isn't a Artifactbin server: every script that talks to it stops with exit code 2 and tells you to set `AF_SERVER`.

## check.mjs

```text
Usage: node scripts/check.mjs <page.html> [--write-ids] [--json]

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
```

With `--write-ids`, each new ID comes before the problems:

```text
$ node scripts/check.mjs page.html --write-ids
page.html:18  added <h1 data-af-id="n1">
page.html:19  added <form data-af-id="n2">
page.html: wrote 2 new IDs.
page.html: no problems found.
```

`check.mjs` can't see elements your own script creates while the page runs. Give those a `data-af-id` from your data, as SKILL.md describes.

## shot.mjs

```text
Usage: node scripts/shot.mjs <page.html> [flags]

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
```

It prints the path of the PNG it saved. Look at it.

To screenshot a particular view, put the page's local state in a JSON file and pass `--state view.json`: the page opens with that state as the viewer's own (the address gets `#af-state=` and the state's JSON in base64url).

## publish.mjs

```text
Usage: node scripts/publish.mjs <page.html> [flags]

Publish a new page, or save your changes to a published one. On
success the file is replaced with the page as the server saved it.
If someone else saved first, their changes are merged into the file
for you to review, or, if they overlap with yours, the latest version
is written to <page>.remote.html and both sides' changes to
<page>.conflict.diff. Keep the .af/ folder next to the page. Sign in
first with auth.mjs, or set AF_TOKEN; uses AF_SERVER (default
https://app.artefactbin.dev).

Flags
  --visibility <policy>  initial private, unlisted or public policy for
                         a new page (default unlisted); never changes
                         an existing page's sharing
  --pull          replace the file with the published page (a changed
                  local copy is backed up in .af/backups/ first)
  --new           publish the file as a new page of your own
  --force         save over the published page even if it changed
                  (the published version is backed up in .af/backups/)
  --delete --yes  trash the page (owner or imported group editor)
  --json          print machine-readable output
  --help          show this help

Exit codes
  0 done                      1 refused, or merged for you to review
  2 usage, token or server    3 server error: nothing saved, run it again later
  4 conflict                  5 no answer: run the same command again

Examples
  node scripts/publish.mjs page.html --visibility private
  node scripts/publish.mjs page.html --pull
```

A new page is published; a published one is saved. The file is then replaced with the page as saved, with its metadata block and every `data-af-id` filled in. Linked backend files that are new or changed since the last publish are sent with it.

```text
$ node scripts/publish.mjs page.html
Published page.html as mO4rv1, version 1. page.html now holds the saved source.
https://app.artefactbin.dev/a/mO4rv1
$ node scripts/publish.mjs page.html
page.html is unchanged since version 1; nothing to save.
```

**Someone else saved first.** If your edits and theirs are on different lines, both are merged into your file and nothing is saved yet (exit 1). Look at the file, then run it again:

```text
$ node scripts/publish.mjs page.html
Someone else saved mO4rv1 first (now version 2). Their changes and yours touch different lines, so page.html now holds both. Nothing was saved: review the file, then run publish.mjs page.html again.
```

If they overlap, your file is left alone (exit 4). The latest version is in `page.remote.html` and both sides' changes are in `page.conflict.diff`. Edit `page.html` to combine them and run it again; that save builds on the latest version, and the two files are removed.

```text
$ node scripts/publish.mjs page.html
Someone else saved mO4rv1 first (now version 4). page.html is unchanged; the overlapping edits are at line 18 of it. The latest version is in page.remote.html and both sides' changes are in page.conflict.diff. Edit page.html to combine them, then run publish.mjs page.html again (or --pull to take theirs, or --force to keep yours).
```

**No answer.** If the connection drops, it is not known whether the save worked (exit 5). Run the same command again: it resends the same request, which the server applies at most once, and then writes the saved page back. A server error (exit 3) keeps the request in `.af/journal/` the same way, and the next run replays it. A replay sends the page and backend files as they were when the request was first made; if you edited a backend file since, the message names it and the following run sends your newer edits.

```text
$ node scripts/publish.mjs page.html
No answer from https://app.artefactbin.dev after 3 tries (fetch failed), so it is not known whether the save applied. Run publish.mjs page.html again: it resends the same request, which the server applies at most once.
$ node scripts/publish.mjs page.html
Resolved the earlier save: Saved mO4rv1, version 7. page.html now holds the saved source.
https://app.artefactbin.dev/a/mO4rv1
```

**Taking the published page.** `--pull` replaces your file with the published page, backing up your copy first if it had changes:

```text
$ node scripts/publish.mjs page.html --pull
page.html now holds version 7 of mO4rv1. Your local copy is backed up at .af/backups/mO4rv1-20261021T104651651Z.html.
```

**A page you can't edit.** Saving someone else's page without edit access fails and names `--new`, which publishes your copy as a new page of your own. Its node IDs stay as they are.

```text
$ node scripts/publish.mjs page.html
You can't save page mO4rv1 with this token (403: You do not have access to this document.). To publish page.html as a new page of your own, run publish.mjs page.html --new.
$ node scripts/publish.mjs page.html --new
Published page.html as lOUAug, version 1. page.html now holds the saved source.
https://app.artefactbin.dev/a/lOUAug
```

`--force` saves your file over a page that changed since you started, after backing up the published version in `.af/backups/`. `--delete --yes` moves the page to recoverable trash for everyone (the owner, or an active editor of an imported group page, can do this) and removes its records from `.af/`.

With `--json` it prints one object: `{ status, id, version, url, wrote, backups, conflict, message }`. `status` is `created`, `saved`, `unchanged`, `merged`, `conflict`, `pulled`, `forked`, `forced`, `deleted`, `pending` (no answer) or `error`. `conflict` is `{ remote, diff, regions }` with the overlapping line ranges, the same on every run until the conflict is resolved.

## comments.mjs

```text
Usage: node scripts/comments.mjs <page.html | page ID> [flags]

List a page's comment threads, see what a commenter saw, reply,
comment, resolve, or watch for new comments. Sign in first with
auth.mjs, or set AF_TOKEN; uses AF_SERVER (default
https://app.artefactbin.dev).

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
```

It takes the page file or its ID. Each comment and reply prints with its ID, the `data-af-id` it is on, and its revision:

```text
$ node scripts/comments.mjs page.html
a81d159f-10fa-4a96-83c4-2d545425f8a0 on n1 "Team todo list" by carol@example.test, version 1, revision 2, resolved
  Is this the final title?
  reply b2aa2b25-c36f-454d-adb6-088ecd299595 by alice@example.test, revision 1: Yes, final.
```

Read what the commenter saw before you act on a comment: `--context <comment>` writes the page and its state as they were then to `.af/context/`, prints their paths, and prints an address that opens the page with that state (with `--json`: `{ comment, source, state, url }`, named as the HTTP API's context response). A reply or new comment with no answer (exit 5) is safe to run again; it is posted once. `--edit` and `--resolve` fail with exit 4 if the comment changed since you last listed it, and show the change; after a run with no answer, that change may be your own earlier attempt.

`--watch` prints one line per new comment, reply, edit or resolve until you stop it. Restarted, it carries on from where it stopped, without repeating anything:

```text
$ node scripts/comments.mjs page.html --watch
reply b2aa2b25-c36f-454d-adb6-088ecd299595 on n1 by alice@example.test (reply to a81d159f-10fa-4a96-83c4-2d545425f8a0): Yes, final.
comment 7a36d665-e62d-4f1c-810f-390b6de2a096 on n2 by alice@example.test: Add a due date field?
```

## secrets.mjs

```text
Usage: node scripts/secrets.mjs [set <NAME> | remove <NAME>] [--json]

Manage the account secrets that backend lambdas you own read as env.
With no command, list each secret's name and when it was last set;
values are never shown. Sign in first with auth.mjs, or set AF_TOKEN;
uses AF_SERVER (default https://app.artefactbin.dev).

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
```

A secret is a value, such as an API key, that lambdas you own read as `env.<NAME>` (see `references/backend.md`). The value is read from standard input, never from an argument, and is never printed:

```text
$ printf '%s' "$STRIPE_KEY" | node scripts/secrets.mjs set STRIPE_KEY
Set STRIPE_KEY (2026-10-21T10:00:00.000Z). Lambdas you own read it as env.STRIPE_KEY.
$ node scripts/secrets.mjs
DB_URL      set 2026-10-21T10:01:00.000Z
STRIPE_KEY  set 2026-10-21T10:00:00.000Z
$ node scripts/secrets.mjs remove STRIPE_KEY
Removed STRIPE_KEY.
```

Setting a name that exists replaces its value. A name must be a capital letter followed by up to 63 capitals, digits and underscores, and an account keeps up to 64 secrets; the server refuses anything else with exit code 1 and says why. A server that keeps no secrets answers `Secrets are not configured` (exit 3).

With `--json` it prints the server's answer: `{ secrets: [{ name, updatedAt }] }` for the list, `{ secret: { name, updatedAt } }` after `set`, and `{ name, deleted: true }` after `remove`.
