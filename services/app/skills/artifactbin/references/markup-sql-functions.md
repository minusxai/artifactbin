---
name: markup-sql-functions
description: Every function a document's SQL may call, the library's and SQLite's own.
---
## Read first

A document's SQL calls SQLite's own functions and the library below, which the
engine adds to SQLite. They are the same in the reader's browser, on the server
and in the CLI. Any other function is refused by name, with the nearest names.
Rules for dates, lists and division: [SQL](markup-sql.md).

```sql
select date_format('2026-09-30', '%A %d %B') as label,
       split_part('a,b,c', ',', 2) as second,
       round(13.975, 2) as rounded
```

## The library

[[ sqlFunctionTable ]]

Library aggregates also run as window functions: `median(x) over (partition by
region)`. `round` rounds half away from zero at the digits as written, the same
everywhere: `round(13.975, 2)` is 13.98. `uuid()` gives a new row its id; like
`random()`, it is allowed only in a `<Mutation>`, because a query must give the
same rows every time it runs.

## SQLite's own

[[ sqliteFunctions ]].

