---
name: permissions
description: Dataset permissions in Hasura's format, the fixed roles, templates and the policy.mjs dry run, read-back and set flow.
---
## Read first

Every dataset has one permission document in Hasura's metadata format (version 3). It decides who
can see, add, change and delete rows, through every door: page GraphQL, a resolver's `caps.query`
and `caps.sql`, direct `graphql.mjs DATASET_ID`, downloads and SQL. Read it, change it and save it
only with `node scripts/policy.mjs` (`--help`). Only the dataset's owner and editors can.

## Roles

Each request has exactly one role, decided by the dataset's own sharing, never by the page:

| Role | Who | Rules |
|---|---|---|
| `owner`, `editor` | The owner, a group editor, a named editor | Always full access |
| `viewer` | A named viewer or commenter share, a group viewer | Denied unless a rule allows |
| `signed_in` | A signed-in account with no share of its own (a link holder, or a page's reader) | Denied unless a rule allows |
| `anonymous` | Signed out (only for unlisted or public datasets) | Denied unless a rule allows |

Someone reading a page that links the dataset, with no share of their own on the dataset, is
`signed_in` if signed in, otherwise `anonymous`: linking grants nothing by default. Rules match one
role exactly, so a rule for `signed_in` does not cover `viewer`: list every role it is for. (A
resolver's `@auth(role: …)` is different: it means "at least", anonymous < signed_in < viewer <
editor < owner; see [resolvers](resolvers.md).)

## The document

```json
{"version":3,"tables":[{"table":{"schema":"public","name":"rows"},
 "select_permissions":[
  {"role":"viewer","permission":{"columns":"*","filter":{},"allow_aggregations":true}},
  {"role":"signed_in","permission":{"columns":"*","filter":{},"allow_aggregations":true}},
  {"role":"anonymous","permission":{"columns":["name","shift"],"filter":{},"limit":200}}],
 "insert_permissions":[{"role":"signed_in","permission":{"columns":["name","shift"],"check":{},
  "set":{"created_by":"X-Hasura-User-Id"}}}],
 "update_permissions":[{"role":"signed_in","permission":{"columns":["shift"],
  "filter":{"created_by":{"_eq":"X-Hasura-User-Id"}},"check":{"created_by":{"_eq":"X-Hasura-User-Id"}}}}],
 "delete_permissions":[{"role":"signed_in","permission":{"filter":{"created_by":{"_eq":"X-Hasura-User-Id"}}}}]}]}
```

A CSV or JSON dataset is one table, `public.rows`. Rules name source columns (as in the file);
`policy.mjs get` shows each column's GraphQL field. `select`: `columns` (`"*"` or a list), `filter`,
`limit` (at most 1000), `allow_aggregations`. `insert`: `columns`, `check`, `set`. `update`:
`columns`, `filter`, `check`, `set`. `delete`: `filter`. Filters use the query `where` grammar.
Hidden columns cannot be read, filtered, sorted or aggregated. A table's `collaborative_columns` (text
columns) are typed in live together with `@afbin/collab`
([datasets](datasets.md#type-together-afbincollab)). `backend_only:true` limits an entry
to the owner's trusted page programs, not page GraphQL or resolvers. `configuration` (the GraphQL
names) is server-owned: omit it or send it unchanged.

Session values, filled by the server: `X-Hasura-User-Id` (the account), `X-Hasura-Page-Id` (the page
the request came through) and `X-Hasura-Role`. A rule needing a value the request lacks denies:
anonymous has no user ID; direct calls have no page ID. Use them in `filter`, `check` and `set`.

## Templates

`node scripts/policy.mjs template NAME DATASET_ID --output p.json`:

- `read-only` (new datasets start here): everyone who can open the dataset reads every row; only
  the owner and editors change rows.
- `own-rows --owner-column created_by`: everyone reads; viewer and signed_in add rows (the column is
  set to them) and change or delete only rows they added; anonymous never writes. The page shows
  edit controls where `_can` says so ([below](#what-this-viewer-may-change)). The CSV needs the owner
  column; rows the owner adds are not stamped. `node scripts/new-app.mjs --kind list` sets up a
  page built on it (`examples/shared-list.html`).
- `editors-only`: only the owner and editors read or write; everyone else gets not found.

For something else (everyone signed in edits every row, hidden columns), edit the template's
`policy` in p.json. `examples/shared-app-policy.mjs` writes a shared-edit table.

## What this viewer may change

Ask, never re-derive a rule in page script: `{tasks_can{insert} tasks{_id _can{update delete}}}`.
`tasks_can.insert`: the viewer's role has an insert rule. A row's `_can.update`/`_can.delete`: the
role has that rule and its `filter` holds for this row (`check` is not tried). Owner and editors:
true; no rule, `backend_only` or a filter on a column the role cannot read: false. `_can` works on
lists, `_by_pk`, `nodes` and `returning`. Draw add, edit and delete controls from it; writes are
still judged. `{viewer{canEdit}}` says whether they may edit the page itself.

## Change permissions: dry run, read-back, set

1. `node scripts/policy.mjs get DATASET_ID --output p.json` (or `template … --output p.json`).
2. Edit `p.json`'s `policy`; keep its `revision`.
3. `node scripts/policy.mjs set DATASET_ID --file p.json --dry-run`: nothing is saved. Fix each
   error by its JSON path (exit 2), then read `readBack`, the server's plain-language summary.
4. `node scripts/policy.mjs set DATASET_ID --file p.json` saves it. Exit 4 means someone changed the
   permissions or the dataset: get again, reapply, set.
5. `node scripts/policy.mjs explain DATASET_ID` prints the read-back again later.

The owner and editors always have full access, so a rule is tested as another role: `anonymous`
with check's `--guest-steps` (signed out), `signed_in` with a second account.

Read the warnings too: anonymous can write; a rule uses `X-Hasura-Page-Id` (direct calls are
denied); an update without `check` lets rows leave the filter; a private dataset never applies
signed_in or anonymous rules. Never grant anonymous writes unless the user asks for them.

A role with no rule for an operation has no such field in its schema (`graphql.mjs schema` shows
what each role gets), so the request fails validation. A row that fails `check` is refused with
`extensions.code` `check_violation`; a rule needing a signed-in session, or a read-only dataset,
gives `permission_denied`. Fix the rule or the request, not the error handling.
