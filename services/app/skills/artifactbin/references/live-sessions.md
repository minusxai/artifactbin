---
name: live-sessions
description: Operate live artifacts with JavaScript, Playwright and window.page.
---
## Read first

A session is a Playwright browser on the server. Read the declared names with
`afbin pull ARTIFACT_ID --output source.jsx`, then drive the page without
editing its source:

```sh
afbin sessions script new --input actions.js --json
afbin sessions script SESSION_ID --input next.js --json
afbin sessions status SESSION_ID --execution EXECUTION_ID --json
afbin sessions close SESSION_ID --json
```

## Who it browses as

As you by default. `--as guest` fetches pages signed out, which is what a
reader with the link sees; a write a guest could not make is refused, and
that refusal is the answer. `--as <testuser-id>` browses as a test user from
`afbin testuser new` (give it its own copy first: `afbin fork <id> --as
<testuser-id>`, [apps](apps.md)). The viewer is fixed at creation; `--as` on a
resumed session is refused.

**Hold one session at a time**: a server runs two by default, shared by everyone.
Create, run, `afbin sessions close SESSION_ID`, then the next `--as`.
`SESSION_CAPACITY` or `SESSION_ACTOR_CAPACITY` created nothing; it lists your
sessions to close, or says to wait.

## Scripts

A script is a strict async function body (top-level `await` and `return`).
It gets `context` (a Playwright BrowserContext, the server as `baseURL`),
`pages` (returned `page_id` → live Page) and `output.image(bytes)` for a
PNG/JPEG. A new session has zero pages:

```js
const page = await context.newPage();
await page.goto('/a/abc123'); // a URL, not a filesystem path
await page.waitForFunction(() => Boolean(window.page));
await page.evaluate(() => { window.page.set('count', 2); });
return await page.evaluate(() => window.page.ready('results'));
```

In `page.evaluate()`, `window.page` is the page's declared names as plain
data, the same signals its [script](markup-scripts.md) binds:

```js
window.page.get('count');                  // a Value, or a Query's rows
window.page.set('count', 3);               // write a Value; queries re-run
await window.page.ready('results');        // the next settled rows
await window.page.mutation('save')({count: 3});  // resolves after commit
```

An undeclared name gives `undefined` (`set` and `ready` throw); a page that
declares nothing has no `window.page`. A refused
write rejects with the server's message: catch it inside `page.evaluate`,
since only the message crosses back. Pass outer variables as the evaluate
argument, not through closures. For the UI, use locators by accessible name
(`page.locator('body').ariaSnapshot()` lists them); the kit's `<Select>` is
a button with a listbox, not a native `<select>`.

`--json` returns `{session_id, execution_id, status, result, pages,
attachments, error?}`; redirect it to a file when it carries images. Use
`pages['PAGE_ID']` in the next script: the DOM survives between calls, script
variables do not. A script error keeps the pages; resume them rather than
rerunning. A timeout that kills the worker is `SESSION_LOST`. Never rerun an
uncertain mutation: `sessions status` recovers its receipt. A truncated
display is not a failed run; read the saved file, never resubmit `new`.

Limits: actions 5 s, navigation 10 s, a script 20 s; 30 idle minutes; 8 pages
and 16 receipts per session.

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

Close it, then rerun `--as guest`: every `$_me.id` write must be refused with
a sign-in offer while reads still work.
Stop once each `<Mutation>` has worked once per identity; retest only a failed run.
