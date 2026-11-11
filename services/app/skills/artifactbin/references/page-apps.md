---
name: page-apps
description: "Read for a page that works like an app: screens and routes in $ values with Back and Forward, links to a screen, opening a page with values, where the page runs (seat), confirmations without confirm(), and calling an external API."
---
## Read first

A page has one address. Keep its screen in the address's `$` values (`?$screen=detail&$id=42`),
never in a path: a path under the page is not the page wherever it is served, so a reload of it
finds nothing.

```js
import {route,seat} from '@afbin/state';
const show=({screen='home',id})=>{/* draw that screen */};
show(route.get());route.subscribe(show); // also fires on the reader's Back and Forward
const go=(link,values)=>{link.href=route.href(values); // copy and new tab work
 link.onclick=e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  e.preventDefault();route.set(values,{push:true});};}; // a plain click stays in the page
go(detailLink,{screen:'detail',id:item.id});
```

- `route.get()`: this address's `$` values, by name without the `$`, as strings.
- `route.set(values,{push})`: replaces every `$` value (an empty, null or undefined one is left
  out); `push:true` adds a history entry so Back returns to the previous screen, otherwise the
  entry is replaced. Names are identifiers; values over 8 KB in total throw a `TypeError`.
- `route.subscribe(listener)`: every change, your own `set` and the reader's Back or Forward;
  returns the unsubscribe. It does not fire on the current value.
- `route.href(values)`: an absolute link to this page with exactly those values (in the app,
  its `/a/ID` address), for copying and opening elsewhere. A plain click on it reloads the whole
  page, so handle the click with `route.set` as above.

In the app, the reader's address bar, a copied link, a reload and Back all follow `route`; at
the page's own address, in `/raw` and in a download it uses that page's own history. A screen
may come back stale: fall back to the default for an unknown value. Keep the screen in `route`,
not in `state`, when a link should open it; keep private choices (a draft, a filter) in
`state`.

## Where the page runs

`seat()` returns where this copy runs and what its data doors can do now:

```js
const {kind,pageId,sql,writes}=seat();
// kind: 'app' (in the app at /a/ID), 'address' (its own address, or a publishing host),
// 'raw' (/a/ID/raw), 'offline' (a downloaded copy), 'preview' (scripts/serve.mjs)
if(!writes)saveButton.disabled=true;
```

`sql` is true where `sql` reads answer (the app, a publishing host's guest reads, a copy's
carried rows), `writes` only in the app (dataset rules still decide). Do not sniff `window.parent` or the runtime's
own tags.

## Opening a page with values

A link with `$` values opens that screen for everyone: `route.href(...)`. A link with
`#af-state=<base64url JSON>` sets the opener's private `state` once, on the page's own address
or its app address (`/a/ID#af-state=…`); the app drops the fragment once the page has it, so a
reload keeps the reader's own state. Pages read seeded values through `state.subscribe`.

## Confirmations and dialogs

In the app and in `/raw` the page runs in a sandboxed frame that shows no browser dialogs:
`alert()` does nothing, `confirm()` returns `false` and `prompt()` returns `null` (the console
says so). Ask with `af-dialog` instead:

```html
<af-dialog id="ask"><af-dialog-content><af-dialog-title>Delete this row?</af-dialog-title>
 <af-dialog-footer><button data-answer="">Cancel</button><button data-answer="yes">Delete</button>
 </af-dialog-footer></af-dialog-content></af-dialog>
<script type="module">
import '@afbin/dialog';
const ask=document.querySelector('#ask');
const confirmed=()=>new Promise(done=>{
 ask.open=true;
 ask.onclick=e=>{const b=e.target.closest('[data-answer]');
  if(b){ask.open=false;done(!!b.dataset.answer);}};
 ask.addEventListener('af-change',e=>{if(!e.detail.value){ask.open=false;done(false);}},
  {once:true});
});
if(await confirmed())deleteRow();
</script>
```

## Calling an external API

Declare its origin, `<meta name="csp-connect" content="https://api.example.com">`, and `fetch`
it with GET: in the app and at the page's own address the browser never connects to it, so the
runtime sends the request through the page's own fetch door, which answers only once this reader
trusts the host (whoever published it does; anyone else is asked on the bar above the page) with
the body and its type, up to 5 MB within 10 s; a refusal is a JSON `{error,detail}` with a 4xx or
5xx status. Request headers, cookies and other methods never pass, and no code of yours runs on
the server: a POST, a key or a check is not something a page can do.
