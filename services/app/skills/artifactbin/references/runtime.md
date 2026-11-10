---
name: runtime
description: "Read for page state and behaviour: viewer-local state with @afbin/state, its defaults and versions, datasets and functions from the page, elements a script creates and their comments, and offline or downloaded pages."
---
## Read first

The platform loads the core runtime and its import map; normal CSS/JS runs without a JSX compiler.

```html
<script type="application/json" data-af="state">{"count":0}</script>
<button id="increment" type="button">Add one</button>
<output id="count">0</output>
<script type="module">
import {state} from '@afbin/state';
const show=({count})=>{document.querySelector('#count').textContent=String(count);};
show(state.getState());state.subscribe(show); // subscribe never fires on the current value
document.querySelector('#increment').onclick=()=>
  state.setState(({count})=>({count:count+1}));
</script>
```

`state` is a Zustand vanilla store of this viewer's private page state: `getState()`,
`setState(partial | fn)`, `subscribe(listener)` (returns the unsubscribe). It persists in that
browser across reloads and follows the viewer's other tabs ([saved state](#saved-state)). Keep
viewer-local state in it, never in platform globals or a parallel localStorage; state everyone
sees lives in a dataset ([datasets](datasets.md)). `@afbin/zustand` is plain Zustand
(`createStore`) for any other store. Unsubscribe listeners when removing their UI.

Dark mode: the runtime sets `<html data-af-dark>` from the reader's switch; read it. A page toggle keeps its choice in local state and sets `document.documentElement.dataset.afDark='true'|'false'` from it on load and toggle.

The reader starts immediately. `@afbin/state` and `@afbin/apollo` load on their first import; await that import before using them. A downloaded page embeds them and works without fetching code.

## Contents

- [Saved state](#saved-state)
- [Dynamic elements and comments](#dynamic-elements-and-comments)
- [Saved comment views](#saved-comment-views)
- [Datasets and functions](#datasets-and-functions)
- [Offline and downloaded pages](#offline-and-downloaded-pages)

## Saved state

`data-af="state"` holds the defaults; each viewer's browser keeps only the keys they changed,
merged one level deep over the current defaults, so a republished default reaches every key a
viewer never changed. A saved value whose JSON type no longer matches its default's is dropped
(a `null` default accepts any type). When a value's meaning changes but not its type (a renamed
tab id), bump `data-af-state-version="2"` on the state block: every viewer's saved changes are
cleared once. Treat saved values as possibly stale: fall back to the default for an unknown one
(`TABS.includes(tab)?tab:'overview'`).

`setState` applies at once; a value that is not storable JSON throws a `TypeError` and changes
nothing. Its promise settles when the save attempt ends and is no receipt: a failed save (an
older open version of the page, repeated races with other tabs) is reported to the console,
never rejects, and the store shows the saved state again; where browser storage is refused,
state lives in memory for this visit only.

## Dynamic elements and comments

Elements in your saved HTML need no `data-af-id`: publish numbers them and carries the numbers across edits. Elements your script creates need one, identical on every render and load. For an element built from a data record, use `<list>-<record id>-<role>` from the record's immutable ID, never its array index, display text, sort order or a random value; an element built from a fixed list in the page's own script (a starter's data block) may use its key or position there:

```js
const item=document.createElement('li');
item.dataset.afId='garden-job-'+job.id;
const title=document.createElement('span');
title.dataset.afId='garden-job-'+job.id+'-title';
title.textContent=job.title;
item.append(title);
document.querySelector('#jobs').append(item);
```

Use a distinct prefix per list and role, keep each ID unique on the page, never reuse a deleted record's IDs, and mount the elements under a container in the saved HTML (`#jobs`). Comments target that node or its `ancestorId`; missing or duplicate IDs never fall back by text. Comment anchors are described atop `scripts/comment.mjs`.

## Saved comment views

A comment saves the reader's view: every top-level field of the state block's JSON (linked dataset and backend names excepted). Keep typed text (drafts, notes, search boxes), tokens and personal information out of the state block, or exclude it:

```html
<script type="application/json" data-af="state" data-af-comment-exclude='["draft"]'>
{"screen":"home","tab":"overview","draft":""}
</script>
```

`data-af-comment-fields='["screen","tab"]'` saves only the named fields instead. Lists hold unique simple field names; an invalid one saves no view and `autofix` refuses it. A saved view restores only while the field set (or an explicit `data-af-comment-version`) is unchanged. Views are bounded JSON (32 KiB): fields that do not fit are left out; incompatible snapshots show a message without changing state.

Opening a thread or pressing its restore button applies the saved fields through the private local store, before target layout. Closing the thread returns fields still equal to the restored values to the viewer's previous values; later deliberate changes are retained. Dataset rows, function answers and writes are never captured or replayed. Target identity rules still apply if the restored screen no longer contains that element.

## Datasets and functions

An HTML link declares one unique `data-af-name` (never `viewer`), bound by the page version to
an authorized dataset or an immutable backend version. Read and write rows with `` sql`…` ``
([datasets](datasets.md)); call a backend function with `fetch('/fn/NAME')`
([functions](functions.md)); browsers never fetch its source. Who reads (signed in, account ID,
page role) is a function's `principal`: return it from one (`me` in `examples/tracker.ts`). Give
guests read-only controls; dataset rules and `roles` still decide. Calls wait up to 3 s for the
hosted parent; with no app connection `sql` rejects with `unavailable` and `/fn` with a
`TypeError`. Do not depend on platform-internal bridge functions.

```js
import {onResolverChange} from '@afbin/apollo';
const changes=onResolverChange(names=>{
 if(names.includes('viewer'))void refreshWho(); // signed in or out: ask the function again
});
// When removing this UI: changes.unsubscribe();
```

Names identify changed links (and `viewer`), not results or grants; `sql.watch` reruns on its
own. Writes never retry: an unknown outcome needs a read before any new write, never a success
message. Errors must reach the UI. Clear private UI on a completed refusal (signed out, access
removed): the rows and the controls that depended on who read, not only a status. Never copy
dataset rows into persisted local state; keep selections and filters local.

## Offline and downloaded pages

A downloaded copy has no app connection: `sql` rejects with `unavailable` and `/fn` calls fail, so show that the data lives in the original page and link to it. Local state works offline. `remoteReadOnly` from `@afbin/apollo` is true in a downloaded copy: disable shared writes when it is. Open the original for sign-in, comments or shared changes. Test downloads.

A URL hash `#af-state=<base64url JSON>` initializes private viewer state and persists it only in that browser; it does not update shared backend data.

## Portable images

An authorized reader can download `/a/ID/download` as one offline HTML file. For portable raster images, use a published image reference:

```html
<img src="ref:abc123" alt="Garden beds after the harvest">
```

Use a real admitted image ID. Download packs readable PNG, JPEG, GIF, WebP and AVIF references in `img/src`, `source/src` and `video/poster` into data URLs. Both the page version's original admission and the downloading reader's current image access are required. Unavailable images refuse the download; unsupported referenced image types return `unsupported_image` (415), and files over 25 MiB return `too_large` (413).

Data images and inline SVG stay intact. External URLs, CSS images and `srcset` are not packed; do not promise them offline.

