---
name: live-sessions
description: Operate live artifacts with JavaScript, Playwright and mx.
---
# Live artifact sessions

Read an artifact with `afbin pull` to understand its declarations, then operate a
live instance without editing its source:

```sh
afbin sessions script new --input actions.js --json
afbin sessions script SESSION_ID --input next.js --json
afbin sessions status SESSION_ID --execution EXECUTION_ID --json
afbin sessions close SESSION_ID --json
```

A script is a **strict async JavaScript function body**: use top-level `await`
and `return`, without exporting or wrapping a function. Each call gets:

- `context`: a real Playwright BrowserContext with the server as `baseURL`.
- `pages`: a read-only object mapping returned `page_id` strings to live Page objects.
- `output.image(bytes)`: attach a PNG/JPEG, e.g. `await output.image(await page.screenshot())`.

```js
const page = await context.newPage();
await page.goto('/a/abc123'); // a URL, not a filesystem path
await page.waitForFunction(() => Boolean(window.mx));
const description = await page.evaluate(() => window.mx.describe());
// Signal values belong to mx. Assigning window.count does not set a signal.
await page.evaluate(() => window.mx.set({count: 2}));
const snapshot = await page.evaluate(() => window.mx.read(['count'], {wait:true}));
await output.image(await page.screenshot());
return {description, snapshot};
```

`--json` returns `{session_id, execution_id, status, result, pages, attachments, error?}`.
Images are `{mime, base64}` attachments. Scripts can open several artifacts,
including multiple copies of one artifact. Returned page IDs remain stable until
those pages close. In the next script use `const page = pages['PAGE_ID']`.
For a session containing one page, standard Playwright also gives
`const [page] = context.pages()`. Call `sessions script SESSION_ID`, not `new`,
to resume it. Values inside your own `return` do not name pages or sessions;
the outer response supplies those IDs.
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
returns a synchronous stop function; snapshots contain only the requested names.
Subscribe to all signals needed by one renderer together. Wait for `window.mx`
after navigation before calling it. On a script error, resume the existing page
IDs; opening another page loses continuity.

Catch API errors inside the page to return their structured fields: Playwright
does not preserve custom Error properties across its evaluation boundary.

```js
return await page.evaluate(async () => {
  try { return await mx.set({count: 2}); }
  catch (error) { return {error: {code: error.code, message: error.message}}; }
});
```

The same [five-method mx API](markup-scripts.md) is exposed on `window.mx` in the
artifact page and managed iframe. Read names from `describe()`. Use
`page.evaluate(() => window.mx.read(['count','results'], {wait:true}))`; selected
values are at `snapshot.signals.NAME.value`. `set` changes scalar signals;
`mutate` runs declared row writes. Neither changes artifact source. A local-table
mutation belongs to this live instance; a dataset mutation persists in the dataset.
Use ordinary Playwright locators for user interactions. Managed content has its
own inner frame: `page.frameLocator('iframe[title="Widget"]').frameLocator('iframe')`.
Inspect the actual controls and their accessible names; use `selectOption` for
native selects, or click a custom select trigger and its option. A native artifact
control is in the main page; it does not require entering a widget frame.

Inspect controls with Playwright's accessibility snapshot before choosing a
locator; raw HTML often buries controls beneath styles and application chrome:

```js
const [page] = context.pages();
return await page.locator('body').ariaSnapshot();
```

The kit's `<Select label="Region">` is a button with a listbox, not an HTML
`<select>`. Operate that control with its accessible names:

```js
const [page] = context.pages();
await page.getByRole('button', {name: 'Region', exact: true}).click();
await page.getByRole('option', {name: 'West', exact: true}).click();
return await page.evaluate(() => mx.read(['region'], {wait: true}));
```

A script error preserves pages. A timeout that destroys the worker returns
`SESSION_LOST`; create a new session explicitly. Never rerun an uncertain mutation
blindly: the CLI prints session/execution IDs before waiting, and `status` recovers
the receipt. A committed dataset write is not rolled back by a later error.

Actions default to 5 seconds, navigation to 10 seconds, and an entire script to
20 seconds. Keep scripts short; move long workflows across calls. Sessions expire
after 30 idle minutes. A session has at most 8 pages and 16 execution receipts;
close it when finished. There is no suspended-to-disk browser heap.
