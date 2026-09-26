---
name: live-sessions
description: Operate live artifacts with JavaScript, Playwright and mx.
---
# Live artifact sessions

Read declarations with `afbin pull ARTIFACT_ID --output source.jsx`, or inspect
`mx.describe()` in a live page. Operate the instance without editing its source:

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

The session is still yours: only you run scripts in it, read its status or close
it, and it counts against your limit. Only the pages are anonymous. A write a
signed-out reader could not make is refused exactly as it would be for a real
guest; that refusal is the answer you came for, not a broken session.
`--as <testuser-id>` browses as a test user — a throwaway PERSON you minted with
`afbin testuser new` — so `$_me.id` is somebody else. A session is a BROWSER and a
test user is a person: several sessions may share one, and a session never mints
one. A test user is a guest on an account's page, so give it its own copy first:
`afbin fork <id> --as <testuser-id>` ([apps](apps.md)).

Who a session browses as is fixed when it is created. `--as` on an existing
session ID is refused locally, and resuming with `afbin sessions script
SESSION_ID` keeps the viewer that session was created with. Compare views by
opening sessions as yourself, `--as guest` and `--as <testuser-id>`.

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
await page.waitForFunction(() => Boolean(window.mx));
const description = await page.evaluate(() => window.mx.describe());
// Signal values belong to mx. Assigning window.count does not set a signal.
await page.evaluate(() => window.mx.set({count: 2}));
const snapshot = await page.evaluate(() => window.mx.read(['count'], {wait:true}));
return {description, snapshot};
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
Image attachments make JSON responses large: redirect `--json > result.json` and
read the IDs/results from it rather than printing base64 into the agent's text
context. A truncated display is not a failed execution; recover the saved response
or use `sessions status`, without resubmitting `new`.
The JavaScript heap and DOM remain live between calls; script variables do not.
Independent operations may use `await Promise.all([...])`; scripts in one session
run sequentially. Playwright functions passed to `page.evaluate()` run in the page:
pass outer variables as its argument, not through closures.

The complete data interface is:

```js
await mx.describe();
await mx.read(['count', 'results'], {wait: true});
await mx.set({count: 2});
await mx.mutate('save', {count: 3});
const stop = mx.subscribe(['count', 'results'], snapshot => { /* render */ });
stop();
```

Call these inside `page.evaluate()`. `set` takes one object patch. `subscribe`
returns a synchronous stop function; snapshots hold only the requested names.
Subscribe to all signals one renderer needs together. Wait for `window.mx` after
navigation before calling it. On a script error, resume the existing page IDs;
opening another loses continuity. Write a recovery script that uses those pages;
do not rerun the original script just to inspect its result.

Catch API errors inside the page to return their structured fields: Playwright
drops custom Error properties across its evaluation boundary.

```js
return await page.evaluate(async () => {
  try { return await mx.set({count: 2}); }
  catch (error) { return {error: {code: error.code, message: error.message}}; }
});
```

The same [five-method mx API](markup-scripts.md) is on `window.mx` in the
artifact page and managed iframe. Read names from `describe()`. Use
`page.evaluate(() => window.mx.read(['count','results'], {wait:true}))`; selected
values are at `snapshot.signals.NAME.value`. `set` changes scalar signals;
`mutate` runs declared row writes. Neither changes artifact source. A local-table
mutation belongs to this live instance; a dataset mutation persists in the dataset.
Use ordinary Playwright locators for interactions. Managed content has its
own inner frame: `page.frameLocator('iframe[title="Widget"]').frameLocator('iframe')`.
Inspect the controls and their accessible names; use `selectOption` for native
selects, or click a custom select trigger and its option. A native artifact
control is in the main page; no widget frame is needed.

Inspect controls with Playwright's accessibility snapshot before choosing a
locator; raw HTML buries controls beneath styles and chrome:

```js
const [page] = context.pages();
return await page.locator('body').ariaSnapshot();
```

The kit's `<Select label="Region">` is a button with a listbox, not an HTML
`<select>`. The example below assumes the label is exactly Region; use the
accessible name from the snapshot. To change a known scalar directly,
`page.evaluate(() => mx.set({region: 'West'}))` needs no locator. To exercise
the UI:

```js
const [page] = context.pages();
await page.getByRole('button', {name: 'Region', exact: true}).click();
await page.getByRole('option', {name: 'West', exact: true}).click();
return await page.evaluate(() => mx.read(['region'], {wait: true}));
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
const after = await page.evaluate(() => mx.read(['tab'], {wait: true}));
if (!after.signals.tab.value.length) await output.image(await page.screenshot());
return after;
```

Screenshot only on a wrong read back. Run it again `--as guest`: every `$_me.id`
write must be refused with a sign-in offer, the reads still work. Fix and push
until both passes are clean.
