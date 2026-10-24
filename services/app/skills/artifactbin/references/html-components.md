---
name: html-components
description: Optional native HTML components, module installation, controlled state and caller-owned data adapters.
---
## Read first

Optional custom elements use light DOM and page tokens. No chart custom element is shipped; native HTML pages can use the separate Vega and Vega-Lite modules directly ([dataviz guide](dataviz.md)). Verify browser behavior; full legacy parity is not implied.

## Load modules

Copy the entire installed `components/` directory into the project, preserving relative imports. Read `.ts` for contracts; load compiled `.js` in the browser. Tests/fixtures are excluded. Keep sibling helpers and bundled engine chunks; an entry file alone is insufficient. No CDN or package install is needed.

```html
<script src="/af/v1/core.js" data-af="core"></script>
<af-input id="search" label="Search"></af-input>
<script type="module">
import {registerInput} from './components/input.js';
registerInput();
</script>
```

Register only needed components; repeat calls are safe. Use [local preview](html-preview.md) and [publication bundles](publication-bundles.md) with the complete module graph, including literal lazy imports. Bare HTML does not carry adjacent files.

## State and events

Persist in Apollo; use typed JS properties. Most controls emit bubbling `af-change` with `event.detail.value`; reflect Apollo values back for controlled use. Button uses `click`; table events differ below.

```html
<script type="application/json" data-af="state">{"search":""}</script>
<script type="module">
import {client,gql} from '@afbin/apollo';
import {registerInput} from './components/input.js';
registerInput();
const input=document.querySelector('#search');
const query=gql`{search}`;
const subscription=client.watchQuery({query}).subscribe(({data})=>{
  input.value=data.search;
});
input.addEventListener('af-change',event=>{
  client.updateQuery({query},state=>({...state,search:event.detail.value}));
});
// Unsubscribe when this UI is removed: subscription.unsubscribe().
</script>
```

Control Switch with `checked`, overlays/Collapsible with `open`, SlideDeck with `index`, other inputs with `value`. Filter nested bubbling events by target. Defaults are transient UI state. See [runtime](html-runtime.md) for Apollo namespaces.

## Controls and composition

Registrations follow PascalCase: `registerDatePicker`, `registerDataTable`, `registerDeckGL`.

| Module | Root and usage |
|---|---|
| `button` | `af-button`: authored label/children; `variant`, `size`, `disabled`, `busy`. |
| `input`, `textarea` | `af-input`, `af-textarea`: `value`, `label`, `placeholder`; native constraints. |
| `slider`, `switch`, `progress` | `af-slider.value` number; `af-switch.checked` boolean; `af-progress.value` 0–100 or null for indeterminate. |
| `select`, `segmented` | Assign `options` as scalars or `{value,label}` objects. `af-select`: `multiple`, `allowCreate`. |
| `date-picker` | `af-date-picker.value`: `YYYY-MM-DD` or null; `min`, `max`, `disabled`. |
| `tabs` | `af-tabs` with `af-tabs-list`, `af-tabs-trigger value="a"`, `af-tabs-content value="a"`; root string `value`. |
| `accordion` | `af-accordion` contains `af-accordion-item value="a"` with `af-accordion-trigger` and `af-accordion-content`; `type="multiple"` uses string-array `value`, single uses a string. |
| `collapsible` | `af-collapsible` with `af-collapsible-trigger`, `af-collapsible-content`; boolean `open`. |
| `dialog`, `popover`, `tooltip` | Root `af-NAME` with `af-NAME-trigger` and `af-NAME-content`; boolean `open`. Use native buttons in triggers. |

## Content and data

| Module | Usage |
|---|---|
| `avatar` | `af-avatar` with `af-avatar-image src="…" alt="…"` and `af-avatar-fallback`. |
| `user` | `af-user.person={id,name,handle,image,profileHref}`; app supplies identity. `loading`, `error`, `identityState` (unknown/missing/deleted), `mode` (user/avatar/handle), `size` (sm/md/lg). |
| `icon` | `af-icon`: `name`, `size`, optional accessible `label`. |
| `markdown` | `af-markdown.source` or literal text; GFM, code highlighting/copy. Property overrides source attribute, then initial text. Unsafe/unsupported content is rejected. |
| `mermaid` | `af-mermaid.code`, `title`, `colorMode` (auto/light/dark), optional `storedImage={src,type,width,height}`; `retry()`. Bundled renderer with visible errors and image fallback. |
| `data-table` | `af-data-table.data={rows,columns}`; columns are schema `{name,type}` records. Display `columns=[{col,title,fmt}]`, `rowKey`, `sort`, `height`, `sticky`, `transpose`; `cellRenderers`/`templates`. |
| `file-upload` | `af-file-upload.value` is file metadata `{ref,name,contentType?,size?}[]`; set `datasetName` (or `dataset` attribute), `adapter`, limits/accept. Emits `af-change` with value and reason upload/remove. |
| `slide-deck` | `af-slide-deck` contains authored `af-slide` children; zero-based `index`; presentation/print. |
| `deck-gl` | `af-deck-gl.options={data,layers,...}`; `boundaries`, `basemap`, `initialViewState`, tooltip/legend. Needs WebGL. |
| `isometric` | `af-isometric.options={title,parts,...}`; keyed geometry, spread/angle/flow, motion. |

DataTable's optional `source.read({offset,limit,sort,signal})` returns `{rows,columns,totalRows?,truncated?}`. Events: `af-sort-change` (sort) and `af-edit-intent` (`{row,key,column,value}`). App owns edits, drafts and transport. `rowKey` must be stable and unique.

FileUpload takes `adapter.upload(file,{dataset,signal})`; optional `fileUrl` resolves previews. Use the real credential-free platform adapter in [HTML uploads](html-uploads.md). Components carry no account credentials or access grants.

## Theme and identity

Use one [design system](html-design-systems.md): `<html data-af-design-system="NAME" data-af-dark="false">`; use `data-af-dark="true"` for dark mode. Components inherit fonts and tokens such as `--background`, `--foreground`, `--primary`, `--border` and `--ring`. No shadow roots are used. Preserve authored `data-af-id`s outside generated output; keep state and record identity outside virtualized cells.

For a User ID from a linked dataset's typed `user` column, request actual cards through that authorized namespace:

```js
const {data}=await client.query({
 query:gql`query($ids:[ID!]!){bookings{people(ids:$ids){id name handle image}}}`,
 variables:{ids:[userId]}
});
element.person=data.bookings.people.find(person=>person.id===userId)??null;
```

Only IDs present in that linked dataset's typed user columns can resolve. Ordinary strings and guessed IDs grant no lookup. Requests accept at most 100 IDs. Current dataset read permission is checked before and after lookup. Offline preview cannot resolve account cards. Keep an absent card null; never invent a name from the ID.
