---
name: website
description: "Read to publish a personal folder on a website or find liked and shared pages."
---
## Read first

Run as the site owner from the installed skill.

```sh
node scripts/groups.mjs website
node scripts/groups.mjs folder-create --personal --title Notes --visibility public
node scripts/publish.mjs page.html --create --personal --parent FOLDER --visibility public
node scripts/groups.mjs place PAGE --parent FOLDER
node scripts/groups.mjs site-set FOLDER
node scripts/groups.mjs site-set FOLDER --alias notes
```

`website` lists your folders, ancestor IDs and mounts. Use ancestry to distinguish duplicate titles.
New folders default to private.
To browse children use `read.mjs list --parent FOLDER`, following `next_cursor`.
For an existing page, `place` checks its current state before moving it.

## Mount or change a folder

The alias `OWNER--notes.PAGES_HOST` uses the existing wildcard DNS and TLS.
Use lowercase ASCII letters, digits and single internal hyphens. Limits are 63 characters for the
combined label and 253 for the host. Renaming the folder preserves the alias.

Repoint with `groups.mjs site-set NEW_FOLDER --alias notes --expected OLD_FOLDER`; remove with
`groups.mjs site-remove notes --expected OLD_FOLDER`. On 409, reread `website` for the current ID.
Omit `--alias` for the main host. Use `root` to select the workspace root.

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
Direct children have NULL parent_id. To list public pages, bind this homepage’s ID:

```sql
SELECT title, url, views, likes FROM _files
WHERE format = 'html' AND id <> ? ORDER BY updated_at DESC, id
```

## Find workspace posts

`node scripts/read.mjs liked --search report --visibility public` finds public liked pages.
`node scripts/read.mjs shared --owner @author --permission editor --from 2026-01-01 --to 2026-01-31`
filters shares by owner, role and inclusive local update dates. Repeat `--permission` to match any
selected role. Both searches match title or ID.

## HTTP

Use an owner account bearer on the app origin. GET /api/my/website returns roots and folders.
PUT there with `{subdomain_label,folder_id}` to create, adding `expected_folder_id` to replace.
DELETE with `{subdomain_label,expected_folder_id}` removes that alias. Empty label is the main site.
POST /api/artifacts with format folder, title, visibility and destination `{"type":"personal"}`.
Supply parent_id on create or PATCH /api/artifacts/ID with parent_id and observed expectedState.
GET /api/me/workspace?part=liked or part=shared returns the authorized artifacts for local filtering.
