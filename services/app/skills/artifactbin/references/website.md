---
name: website
description: "Read to organize personal folders, publish a folder on an owner website, and search the liked and shared shelves."
---
## Read first

Run these commands from the installed skill. For a personal site, sign in as its owner.

```sh
node scripts/groups.mjs website
node scripts/groups.mjs folder-create --personal --title Notes --visibility public
node scripts/publish.mjs page.html --create --personal --parent FOLDER --visibility public
node scripts/groups.mjs place PAGE --parent FOLDER
node scripts/groups.mjs site-set FOLDER
node scripts/groups.mjs site-set FOLDER --alias notes
```

`website` lists all your live personal folders (ID, title, ancestor IDs) and current mounts.
Choose by ID after checking the hierarchy for duplicate titles. Folder creation defaults to private.
To browse children use `read.mjs list --parent FOLDER`, following `next_cursor`.
A new page can use publish's `--parent`. For an existing page, `place` reads its state and
conditionally changes its parent within the same ownership.

## Mount or change a folder

The main site uses the empty label. A named alias uses one flat host label,
`OWNER--notes.PAGES_HOST`, covered by the publishing host's existing wildcard DNS and TLS.
Use lowercase ASCII letters and digits with single internal hyphens. The combined DNS label must
fit 63 characters and the full hostname 253. The mapping follows the folder ID across renames.

A first set creates only. Read settings before changing an existing mapping. To repoint, use
`groups.mjs site-set NEW_FOLDER --alias notes --expected OLD_FOLDER`. To remove the observed alias,
use `groups.mjs site-remove notes --expected OLD_FOLDER`. A collision or stale expected folder
returns 409. Reread and reconcile. Use `root` for the account root (a configured null folder).
Omit `--alias` to configure the main host.

## Link and index behavior

The app resolves `/@handle/notes/field-report` from folder and page titles. Each segment must be
readable by title. Use `/a/ID` for a stable app link. The website resolves public title slugs
relative to its mount, e.g. `/field-report`. On collisions or reserved paths use the ID link
(`/ID` for a page, `/folders/ID` for a folder). A rename changes a title path. Private or
unlisted ancestors hide descendants on the website, including ancestors above the mount.

A configured directory serves its direct public HTML child whose title slugs to `index` (earliest
created, then ID). Without one the directory returns a 404 Not found page. Public children can
still return 200 at their own paths. An unconfigured main site retains the account-wide index
lookup and generated listing fallback. An unconfigured alias returns 404.

## Build the homepage list

On the owner website, page SQL supplies the read-only `_files` table for public entries within
the mount. Columns are `id, parent_id, title, format, url, created_at, updated_at, views, likes`.
Views and likes are numeric totals. Direct children have null parent_id. Use the emitted URL.
To list public HTML pages excluding assets and this homepage, bind the homepage ID:

```sql
SELECT title, url, views, likes FROM _files
WHERE format = 'html' AND id <> ? ORDER BY updated_at DESC, id
```

## Find workspace posts

`node scripts/read.mjs liked --search report` filters readable liked pages by title or ID.
`node scripts/read.mjs shared --owner @author --permission editor --from 2026-01-01 --to 2026-01-31`
filters the signed-in account's email shares by exact owner handle, share role and inclusive local
calendar days of the last update. Omit filters to inspect the inventory.

## HTTP

Use an owner account bearer on the app origin. GET /api/my/website returns roots and folders.
PUT there with `{subdomain_label,folder_id}` to create, adding `expected_folder_id` to replace.
DELETE with `{subdomain_label,expected_folder_id}` removes that alias. Empty label is the main site.
POST /api/artifacts with format folder, title, visibility and destination `{"type":"personal"}`.
Supply parent_id on create or PATCH /api/artifacts/ID with parent_id and observed expectedState.
GET /api/me/workspace?part=liked or part=shared returns the authorized artifacts for local filtering.
