---
name: live-sessions
description: Operate live artifacts with JavaScript, Playwright and window.page.
---
# Live artifact sessions

Read the declared names with `afbin pull ARTIFACT_ID --output source.jsx`. Operate
the instance without editing its source:

```sh
afbin sessions script new --input actions.js --json
afbin sessions script SESSION_ID --input next.js --json
afbin sessions status SESSION_ID --execution EXECUTION_ID --json
afbin sessions close SESSION_ID --json
```

## Who the session browses as

A session browses as you, so its pages show what your account can see. Create it
with `--as guest` and its pages are fetched signed out instead — what a reader
with the link sees, which is how to check a page you published before handing it
over:

```sh
afbin sessions script new --as guest --input actions.js --json
```

The session is still yours; only the pages are anonymous. A write a signed-out
reader could not make is refused as it would be for a real guest; that refusal
is the answer you came for, not a broken session.
`--as <testuser-id>` browses as a test user — a throwaway PERSON you minted with
`afbin testuser new` — so `$_me.id` is somebody else. A session is a BROWSER and a
test user is a person: several sessions may share one, and a session never mints
one. A test user is a guest on an account's page, so give it its own copy first:
`afbin fork <id> --as <testuser-id>` ([apps](apps.md)).

Who a session browses as is fixed when it is created: resuming `afbin sessions
script SESSION_ID` keeps that viewer, and `--as` there is refused.

**Hold one session at a time**: a server runs two by default, shared by everyone.
Go identity by identity: create, run, `afbin sessions close SESSION_ID`, then
the next `--as`. `SESSION_CAPACITY` or `SESSION_ACTOR_CAPACITY` created nothing;
it lists your sessions to close, or says to wait.

A script is a **strict async JavaScript function body**: use top-level `await`
and `return`, without exporting or wrapping a function. Each call gets:

- `context`: a real Playwright BrowserContext with the server as `baseURL`.
- `pages`: a read-only object mapping returned `page_id` strings to live Page objects.
- `output.image(bytes)`: attach a PNG/JPEG, e.g. `await output.image(await page.screenshot())`.

A `new` session starts with **zero pages**. Its first script must create a page
with `await context.newPage()`. Use `context.pages()` or `pages[page_id]` only
after a page has been created. Reuse the returned session ID for subsequent
scripts, including inspection and recovery after an ordinary script error.

```js
const page = await context.newPage();
await page.goto('/a/abc123'); // a URL, not a filesystem path
await page.waitForFunction(() => Boolean(window.page));
// Assigning window.count sets nothing: the declared Value is window.page.set('count', …).
await page.evaluate(() => { window.page.set('count', 2); });
return await page.evaluate(() => window.page.ready('results'));
```

An OLDER version is the same address plus `?version=N`:
`page.goto('/a/abc123?version=2')` renders version 2 under a "Version 2 of 7 ·
read-only" line — no editing, no commenting, every `<Mutation>` refused — for
whoever may read the history (its owner and editors); everyone else gets
not-found. `afbin export <id>@2 --format png` shoots that same page.

`--json` returns `{session_id, execution_id, status, result, pages, attachments, error?}`.
Images are `{mime, base64}` attachments. Scripts can open several artifacts,
including multiple copies of one. Returned page IDs remain stable until
those pages close. In the next script use `const page = pages['PAGE_ID']`.
Image attachments make JSON large: redirect `--json > result.json` and read IDs
and results from it, not base64 in your context. A truncated display is not a
failed execution; read the saved file or `sessions status`, never resubmit `new`.
The JavaScript heap and DOM remain live between calls; script variables do not.
Independent operations may use `await Promise.all([...])`; scripts in one session
run sequentially. Playwright functions passed to `page.evaluate()` run in the page:
pass outer variables as its argument, not through closures.

`window.page` reads and writes the declared names, the same signals the page's
own script binds from `page` ([scripts](markup-scripts.md)), as plain data:

```js
window.page.get('count');                  // a Value: read it
window.page.set('count', 3);               // write it; queries re-run
window.page.get('results');                // a Query or table Value: its rows
await window.page.ready('results');        // the next settled rows
await window.page.mutation('save')({count: 3});  // resolves after commit
```

Call these inside `page.evaluate()`. An undeclared name gives `undefined`
(`set` and `ready` throw). Wait for `window.page` after navigation; a
page that declares nothing has none. On a script error, resume the existing page
IDs; opening another loses continuity. Write a recovery script that uses those
pages; do not rerun the original script just to inspect its result.

A refused write or failed query rejects with the server's message. Catch it
inside the page: Playwright keeps only the message across its boundary.

```js
return await page.evaluate(async () => {
  try { await window.page.mutation('save')(); return 'saved'; }
  catch (error) { return {error: error.message}; }
});
```

Neither a write nor a mutation changes artifact source. A local-table mutation
belongs to this live instance; a dataset mutation persists in the dataset.
Use ordinary Playwright locators for interactions: every control, and every
component the script mounts, is in the main page. Inspect the controls and their
accessible names; use `selectOption` for native selects, or click a custom
select trigger and its option.

Inspect controls with Playwright's accessibility snapshot before choosing a
locator; raw HTML buries controls beneath styles and chrome:

```js
const [page] = context.pages();
return await page.locator('body').ariaSnapshot();
```

The kit's `<Select label="Region">` is a button with a listbox, not an HTML
`<select>`. The example below assumes the label is exactly Region; use the
accessible name from the snapshot. To change a known scalar directly,
`page.evaluate(() => { window.page.set('region', 'West'); })` needs no
locator. To exercise the UI:

```js
const [page] = context.pages();
await page.getByRole('button', {name: 'Region', exact: true}).click();
await page.getByRole('option', {name: 'West', exact: true}).click();
return await page.evaluate(() => window.page.get('region'));
```

A script error preserves pages. A timeout that destroys the worker returns
`SESSION_LOST`; create a new session. Never rerun an uncertain mutation
blindly: the CLI prints session/execution IDs before waiting, and `status` recovers
the receipt. A committed dataset write is not rolled back by a later error.

Actions default to 5 s, navigation to 10 s, a whole script to 20 s. Keep scripts
short; move long workflows across calls. Sessions expire after 30 idle minutes.
A session holds at most 8 pages and 16 receipts; close it when finished. There is
no suspended-to-disk browser heap.

## Testing a page you built

A push proves markup and reads; only a run proves a `<Mutation>`:

```js
const page = await context.newPage();
await page.goto('/a/abc123');
await page.getByLabel('Amount').fill('48.50');
await page.getByRole('button', {name: 'Add expense'}).click();
await page.waitForFunction(() => Boolean(window.page));
const after = await page.evaluate(() => window.page.ready('tab'));
if (!after.length) await output.image(await page.screenshot());
return after;
```

Screenshot only on a wrong read back. Close it, then rerun `--as guest`: every
`$_me.id` write must be refused with a sign-in offer, the reads still work.
Stop once each `<Mutation>` has worked once per identity; retest only a failed run.
