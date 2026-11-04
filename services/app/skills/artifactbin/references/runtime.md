---
name: runtime
description: Normal HTML scripts and Apollo state, viewer-local persistence, shared namespaces and offline behavior.
---
## Read first

The platform loads the core runtime and its import map; normal CSS/JS runs in the browser without a JSX compiler.

```html
<script type="application/json" data-af="state">{"count":0}</script>
<button id="increment" type="button">Add one</button>
<output id="count">0</output>
<script type="module">
import {client,gql} from '@afbin/apollo';
const state=gql`{count}`;
client.watchQuery({query:state}).subscribe(({data})=>{
  document.querySelector('#count').textContent=String(data.count);
});
document.querySelector('#increment').onclick=()=>{
  client.updateQuery({query:state},({count})=>({count:count+1}));
};
</script>
```

State in `data-af="state"` initializes each viewer’s private browser state, which then persists in that browser across reloads and tabs. Keep all page state through `client`; never rely on platform-injected globals, use localStorage as a parallel store or assume local state is shared. `const {data}=await client.query({query})` reads it (saved values from the first call); `client.updateQuery` changes it; `watchQuery(...).subscribe` observes changes. Unsubscribe listeners when removing their UI.

Dark mode: the runtime sets `<html data-af-dark>` from the reader's switch; read it. A page toggle keeps its choice in local state and sets `document.documentElement.dataset.afDark='true'|'false'` from it on load and toggle.

The reader starts immediately. The client engine loads on the first `@afbin/apollo` import; await that import before using it. A downloaded page embeds the engine and works without fetching code.

## Contents

- [Dynamic elements and comments](#dynamic-elements-and-comments)
- [Saved comment views](#saved-comment-views)
- [Local mutations](#local-mutations)

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

A comment saves the reader's view: every top-level field of the state block's JSON (linked dataset and resolver names excepted). Keep typed text (drafts, notes, search boxes), tokens and personal information out of the state block, or exclude it:

```html
<script type="application/json" data-af="state" data-af-comment-exclude='["draft"]'>
{"screen":"home","tab":"overview","draft":""}
</script>
```

`data-af-comment-fields='["screen","tab"]'` saves only the named fields instead. Lists hold unique simple field names; an invalid one saves no view and `autofix` refuses it. A saved view restores only while the field set (or an explicit `data-af-comment-version`) is unchanged. Views are bounded JSON (32 KiB): fields that do not fit are left out; incompatible snapshots show a message without changing state.

Opening a thread or pressing its restore button applies the saved fields through the private local store, before target layout. Closing the thread returns fields still equal to the restored values to the viewer's previous values; later deliberate changes are retained. Dataset and resolver data and mutations are never captured or replayed. This is saved comment context, not live sharing or following another reader's local state. Target identity rules still apply if the restored screen no longer contains that element.

## Local mutations

A local mutation changes only this viewer’s state:

```js
client.addResolvers({Mutation:{increment(draft,args){draft.count+=args.by;return draft.count}}});
await client.mutate({mutation:gql`mutation {increment(by:1)}`});
```

## Remote namespaces

An HTML link declares one unique `data-af-name` (never `viewer`). The page version binds it to an immutable resolver version or authorized dataset. Query with `client.query`: a dataset's generated fields are top-level (`{targets{category amount}}`), a resolver's stay under its name (`{budget{total}}`). The browser never fetches a resolver’s source.

Every page answers `{viewer{signedIn id name}}`, no link needed: `id` is the account ID (`principal.subject`, `X-Hasura-User-Id`), `name` the display name; signed out, `{signedIn:false,id:null,name:null}`. Sign-in/out refreshes it (`onResolverChange` names include `viewer`). Give guests read-only controls; `@auth` and dataset rules still decide.

Remote queries wait up to 3 s for the hosted parent to attach, else return offline errors without sending. Do not depend on platform-internal bridge functions.

Use `onResolverChange` for manual invalidation and reconnect handling:

```js
import {onResolverChange} from '@afbin/apollo';
const changes=onResolverChange(names=>{
 if(names.includes('budget'))void refresh(); // your function re-queries shared facts
});
// When removing this UI: changes.unsubscribe();
```

Names identify changed namespaces, not results or grants. `watchQuery` observes local fields and remote reads; invalidation, reconnect and committed mutations refresh remote reads without persisting results. `loading` is true while pending, false on answer/error. `clearOnRefresh:true` clears remote fields before reads. Clear private UI on completed refusal; unsubscribe on removal. Mutations never retry automatically.

Remote data is never silently copied into persisted local state. Keep temporary selections or filters local; read shared facts through their namespace. Query/mutation errors must reach the UI. An unknown write outcome requires recovery; never turn it into a success message or a second new mutation.

## Offline and downloaded pages

Linked downloads read permitted public data/comments; private resources stay unavailable. Local state works offline. `remoteReadOnly` from `@afbin/apollo` stays true for portable remote access, offline or connected. False hosted/local-preview datasets never promises write access. Disable shared writes when true. Open original for sign-in, comments or shared changes. Initial queries wait at most 15s; Stay offline/private preview return immediately. Mutations never queue or replay. Files carry no tokens. Test downloads.

A URL hash `#af-state=<base64url JSON>` initializes private viewer state and persists it only in that browser; it does not update shared backend data.

## Portable images

An authorized reader can download `/a/ID/download` as one offline HTML file. For portable raster images, use a published image reference:

```html
<img src="ref:abc123" alt="Garden beds after the harvest">
```

Use a real admitted image ID. Download packs readable PNG, JPEG, GIF, WebP and AVIF references in `img/src`, `source/src` and `video/poster` into data URLs. Both the page version's original admission and the downloading reader's current image access are required. Unavailable images refuse the download; unsupported referenced image types return `unsupported_image` (415), and files over 25 MiB return `too_large` (413).

Data images and inline SVG stay intact. External URLs, CSS images and `srcset` are not packed; do not promise them offline. Packing adds no backend data or credentials. Test the download without a network.

