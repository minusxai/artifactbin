# Retiring the compatibility shims

On 2026-10-09 the backfills ran on production with `--apply` (a dump of `artifacts`,
`artifact_versions`, `artifact_node_aliases` and `annotations` was taken first, on the production
host): `retired-themes` changed 7 rows, `sqlite-versions` 4,308, `legacy-anchors` 6. The change
that followed deleted those scripts with the code they unlocked: the SQLite-syntax converter and
its on-the-fly serving, the lazy source-to-graph migration and every non-graph branch of
`decodeDocument`, the retired theme alias, the legacy-anchor alias machinery and table, and the
`users.is_guest` / `users.password_hash` columns.

What production still holds in a retired shape is refused by name, never converted:
`lib/artifacts/servable` answers 410 `unservable_document` for 3 trashed heads and 13 archived
versions without `meta.dataSyntax: 2`, and for one archived version whose stored bytes do not
parse. Restore any of them from the dump if it is needed. 137 archived versions still carry
`data-annotation-anchor`; there it is an inert attribute.

One script remains. It reports first and writes only with `--apply` (`common.ts`; the target is
printed without credentials):

```sh
DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/legacy-anchors.ts [--apply] [--detach-orphaned-anchors] --live-objects
```

| script | what it does | left on production |
|---|---|---|
| `legacy-anchors.ts` | Republishes a live document still carrying `data-annotation-anchor` without it (a free legacy key becomes its element's `id`; comments on other keys are repointed in the same transaction). With `--detach-orphaned-anchors`, a comment whose key names no node is detached (`anchor_key` NULL) instead of blocking the document. A second run is a no-op. | hAoPxJ (anchor a40hykrmo), slGJqK (anchor a54jnhj8s): run with `--detach-orphaned-anchors` |

Tests: `services/app/__tests__/retire-shims.test.ts`.
