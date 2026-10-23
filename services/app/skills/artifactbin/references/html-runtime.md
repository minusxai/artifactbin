---
name: html-runtime
description: Normal HTML scripts and Apollo state, viewer-local persistence, shared namespaces and offline behavior.
---
## Read first

Load the one core script before author scripts. It supplies the import mapping; normal CSS/JS runs in the browser without a JSX compiler.

```html
<script src="/af/v1/core.js" data-af="core"></script>
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

State in `data-af="state"` initializes each viewer’s private browser state. Keep all page state through `client`; never rely on platform-injected globals, use localStorage as a parallel store or assume local state is shared. `client.query({query})` reads it; `client.updateQuery` changes it; `watchQuery(...).subscribe` observes changes. Unsubscribe listeners when removing their UI.

## Dynamic elements and comments

The server numbers elements present in saved HTML; preserve those returned `data-af-id` values. It cannot number elements your script creates later. Give each such element a stable identity derived from an immutable record ID and its role, not an array index, display text, sort order or a fresh random value on every render:

```js
const item=document.createElement('li');
item.dataset.afId='garden-job-'+job.id;
const title=document.createElement('span');
title.dataset.afId='garden-job-'+job.id+'-title';
title.textContent=job.title;
item.append(title);
document.querySelector('#jobs').append(item);
```

Keep the `#jobs` container in saved HTML so publication gives it a persistent source identity. Re-rendering the same logical job keeps its IDs, including after sorting or filtering. Use distinct prefixes for different lists and roles; avoid duplicate IDs. Never reuse a deleted job’s IDs for a new job, or borrow an existing source element’s identity.

When someone comments on a runtime-created element, the platform captures its identity and scopes it to the nearest persisted source ancestor automatically. The comment contract may include `ancestorId`; page authors do not construct anchors or call an anchor-registration API. Keep dynamic content under its intended saved container. Missing targets or missing/duplicate scopes do not fall back to matching text elsewhere; a comment must not silently move to another record.

## Local mutations

A local mutation changes only this viewer’s state:

```js
client.addResolvers({Mutation:{increment(draft,args){draft.count+=args.by;return draft.count}}});
await client.mutate({mutation:gql`mutation {increment(by:1)}`});
```

## Remote namespaces

An HTML link declares one unique `data-af-name`. The published page version binds it to an immutable backend version or authorized dataset. Query through that namespace with `client.query`, for example the GraphQL query `{garden{jobs{id title done}}}` for the backend in the shared-app example. A backend’s source filename is an authoring file, not a URL the browser fetches.

Remote queries wait up to three seconds for the trusted hosted parent to attach. If it never attaches, they return offline errors without sending a request. Do not depend on platform-internal bridge functions.

Subscribe to shared-data invalidation with the named export `onBackendChange`:

```js
import {onBackendChange} from '@afbin/apollo';
const changes=onBackendChange(names=>{
 if(names.includes('garden'))void refresh(); // your function re-queries shared facts
});
// When removing this UI: changes.unsubscribe();
```

Names identify changed linked namespaces. Re-query them; the notification is not a result or permission grant. `watchQuery` observes viewer-local state, not shared-data updates. The platform never retries a mutation automatically.

Remote data is never silently copied into persisted local state. Keep temporary selections or filters local; read shared facts through their namespace. Query/mutation errors must reach the UI. An unknown write outcome requires recovery; never turn it into a success message or a second new mutation.

## Offline and downloaded pages

Local state keeps working without a network. Shared mutations cannot commit offline; report the offline outcome and retain the user’s intent. A downloaded file never carries account tokens. The current downloaded core has no reconnect protocol: backend query fields are null with offline errors, and mutations have an offline outcome. Do not teach sign-in or reconnect from a downloaded file. Do not claim a shared action succeeded until the remote receipt confirms it. Test downloads independently from the live page.

A URL hash `#af-state=<base64url JSON>` initializes private viewer state and persists it only in that browser; it does not update shared backend data.

## Portable images

An authorized reader can download `/a/ID/download` as one offline HTML file. For portable raster images, use a published image reference:

```html
<img src="ref:abc123" alt="Garden beds after the harvest">
```

Replace the example ID with a real admitted image artifact. Download packs readable PNG, JPEG, GIF, WebP and AVIF references in `img/src`, `source/src` and `video/poster` into data URLs. Both the page version's original admission and the downloading reader's current image access are required. Unavailable images refuse the download; unsupported referenced image types return `unsupported_image` (415), and files over 25 MiB return `too_large` (413).

Existing data images and inline SVG stay intact. External URLs, CSS images and `srcset` are not automatically packed; do not promise those assets work offline. Image packing does not snapshot remote backend data or add credentials or reconnection. Test the downloaded file without a network.
