# Retiring the compatibility shims production data has not yet cleared

Five scripts, prepared as reviewed code and **not run anywhere** (not in CI, not on a boot path, not
in a workflow). Each one reports first and writes only with `--apply`:

```sh
DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/<script>.ts            # dry run, the default
DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/<script>.ts --apply    # writes
```

Common behaviour (`common.ts`): `DATABASE_URL` is read through `lib/platform/config`; the target (host
and path, no credentials) is printed first; a dry run opens no transaction; `--apply` logs every changed
id as it commits; the exit report lists `blocked` ids with the reason. Every script is idempotent: a
second `--apply` finds nothing it already wrote. Each is tested on an isolated PGLite fixture in
`services/app/__tests__/retire-shims.test.ts`. Rehearse every one on a restored copy before production:
the dry-run counts below are the claim that makes each deletion safe, and they were measured read-only
on 2026-10-09.

## Order

1. `bare-scripts.ts` (report only, any time; decides nothing else)
2. `retired-themes.ts`
3. `source-kind-documents.ts`
4. `sqlite-versions.ts` (versions and trashed heads must be converted before the SQLite code goes)
5. `legacy-anchors.ts` (the one that republishes live documents; last, and watched)

Run the dry run of each, read `blocked`, then `--apply`, then the dry run again: the candidate count
that remains is the work still blocking the deletion.

## The scripts

| script | what it changes | production, 2026-10-09 | unlocks (delete) |
|---|---|---|---|
| `sqlite-versions.ts` | Archived `artifact_versions` and **trashed** heads that are markup without `meta.dataSyntax: 2`: the migration's own converter (`convertStoredDocument`) is applied in place and the row gets the marker and a `dataSyntaxMigration` stamp. `manual` rows (the converter needs a person) are never touched, only listed. | 4,222 of 5,957 versions unmigrated (2,533 created in the last 30 days); 102 of 442 trashed heads; 0 live heads | `lib/migrate/sqlite/*` (about 2,350 lines), `lib/artifacts/sqlite-syntax-migration.ts` (223), `scripts/migrate/sqlite/*` (418), the `previousEngine` plumbing, and about 780 test lines — **only if the report has no `manual` row** |
| `retired-themes.ts` | `meta.theme` of a retired name becomes its successor (derived from `RETIRED_STORY_THEMES` through `resolveStoredStoryDesign`, with the implied colorMode when none was pinned), on heads (live and trashed) **and** archived versions. | 7 documents named `classical` (last updated 2026-08-20); versions not yet counted, the dry run counts them | the `RETIRED_STORY_THEMES` alias and its read-path use (`resolveStoredStoryDesign`, `servedDesign`), about 40 lines |
| `source-kind-documents.ts` | Runs the lazy `loadArtifactDocument` migration eagerly on every head and version whose `document.kind` is not `graph`. A row whose bytes do not parse cannot become a graph and is reported as blocked. | heads: all `graph`; versions: 1 row of kind `source` (2026-09-03); `semantic` and `jsx`: 0 | the lazy source-to-graph migration in `lib/artifacts/document.ts` (about 25 lines) and the `semantic`/`jsx` branches of `decodeDocument` (about 15) — the `source` branch stays while a blocked row exists |
| `legacy-anchors.ts` | Live documents with a `data-annotation-anchor` attribute are republished through `publishMarkupForArtifact` + `commitNormalizedMarkup` (stamping with `retireLegacyAliases`: the legacy key becomes the node id, or an alias is recorded and annotations are repointed). Refuses, before any write, a document whose annotation anchors would stop resolving. Trashed documents are listed, not written. | 9 sources carry the attribute (7 in 2026-09, 2 in 2026-08); 0 alias rows | with 0 live, 0 trashed and 0 archived carriers, the `ANNOTATION_ANCHOR_ATTR` fallback in `anchorKeyOf` and the alias branches in `node-ids.ts`, `document.ts`, `store.ts` can be considered (held: not deleted by this change) |
| `bare-scripts.ts` | **Nothing; report only** (no `--apply`). Lists live documents whose Lambda handler is a bare `<script>`, by the runner's own predicate (`bareHelmetScript`, shared with `lib/runner/resolve.ts`), as `used`, `shadowed` or `invalid`. | 507 candidates by a crude text filter, so the real count is unknown until this runs | the three-line bare-script compatibility branch in `lib/runner/resolve.ts` once `used` is 0; the fix for a `used` document is an author's edit (`type="server"`) |

## Things a reviewer should know

- `sqlite-versions.ts` writes history and trashed heads in place (they cannot go through the publish
  door): `version`, `edit_id` and `deleted_at` are kept, the source is stored as a graph with `source`
  NULL (as the lazy representation migration already writes archives), and no edit-log row is added. A
  client holding a pre-trash `edit_id` for a trashed head has a base the log no longer describes; the
  restore path converts through `convertArtifactNow` anyway, so this is the same bytes `inCurrentSyntax`
  serves today. Converted bytes gain no node ids until the document is next published.
- `retired-themes.ts` leaves `compiledCss` alone: it is stale by `cssCompileVersion` and recompiles on read.
- `legacy-anchors.ts` needs the query engine in process (`--objects <dir>` or `--live-objects`, as the
  SQLite scripts), because the publish door validates the document; a dry run still prepares each
  document through that door and reports a refusal.
- No script changes a schema column; the `users.is_guest` and `users.password_hash` drops stay a
  separate schema migration.
