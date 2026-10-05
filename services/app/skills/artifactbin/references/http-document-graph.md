---
title: HTTP document graph contract
description: Exact graph update fields, stable node identity and observed concurrency guards for direct HTTP clients.
---
## Document graph wire contract

Read `GET /api/artifacts/<id>` before editing. Read its `markup` source and keep its `document` (schema 3 graph), `version` and `edit_id`; source alone does not contain the concurrency/identity facts. `document.nodes` is keyed by opaque graph keys; `$root` owns the ordered top-level `children`. Each node has an encoded own `ast`, ordered child graph keys and `parts` interleaved around the children. Its own `units`/`partUnits` count UTF-16 code units; `bytes` counts UTF-8 bytes. `subtreeUnits` includes descendants. `selfVersion`, `childrenVersion` and `subtreeVersion` are revision facets. `selectors` contains facts such as `id:message`; `claimedIds` remembers every body-element ID ever claimed, including retired IDs. Do not reuse retired IDs for different elements.

Submit `POST /api/artifacts/<id>/edits` with `{"edit_id":"<observed edit_id>","document_update":{...}}`. `document_update.schema` is 1:

| Field | Required meaning |
| --- | --- |
| `patch.baseVersion` | Observed artifact version. |
| `patch.reads` | Every graph fact on which validation/operation depends: `{key,facet,version}` using the actual observed facet revision, not the artifact version. |
| `patch.selections` | Selector results the operation depended on, e.g. `{selector:"id:message",keys:["<observed paragraph key>"]}`. Preserve the sorted observed keys. |
| `patch.updated` | Map graph keys to `{patches,self,children}`. JSON paths are arrays of strings, relative to that node; patch kinds are `set`, `insert`, `delete`, or `text` (UTF-16 `start`/`deleteCount`). Own-field paths can start with `ast`, `selectors`, `refs`, `parent`, `children`, `parts`, `bytes`, `units`, `partUnits`, or `prose`. Never write revision/aggregate fields as own-field patches. |
| `patch.inserted` / `removed` | New complete graph-node records keyed by fresh internal keys / removed graph keys. Preserve parent-child links, serialized own parts, selectors/references, counts and child order. |
| `patch.touched` | Changed nodes and their surviving ancestors whose subtree revisions advance. |
| `patch.byteDelta` / `unitDeltas` | Total UTF-8 byte change / per-node subtree UTF-16 length deltas, including ancestors. |
| `patch.claims` | Newly introduced body-element IDs with their observed `claimedIds[id]` revision, or `null` if never claimed. Retain IDs for the same element; do not recycle IDs from deleted elements. A text-only edit has no new claims. |
| `effects` | `{css,references}`: true only when the corresponding classes/design inputs or reference bindings change, invalidating derived caches. |

The commit checks permissions and these dependencies atomically. A conflicting read, selection or claim returns 409 without partial writes. Independent changes may succeed from an older base; do not guess revisions or omit dependencies to force an edit through. On 409, read again and rebuild the proposed change against the new snapshot.

For an executable direct JSON example, read [HTTP authoring](http-authoring.md).
