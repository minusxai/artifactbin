---
name: markup-sql
description: SQL functions, query engines and current parser limitations.
---
## Choose the query engine

| Query | Function surface |
|---|---|
| No `source` | DuckDB over inline table Values and other query results, named as bare tables. |
| Stored/file dataset `source="ref:…"` | DuckDB over the dataset's exposed catalog tables, usually `public.rows`, with additional catalog checks. |
| PostgreSQL dataset | The PostgreSQL compiler and read-only connection described in [catalogs](databases.md); do not assume DuckDB syntax. |

Local and DuckDB dataset reads accept one SELECT (including WITH), bound `$name`
parameters, casts, CASE, aggregates, windows and built-in scalar functions. There
is no separate short allowlist of scalar-function names. Useful families include
`coalesce`/`nullif`, `lower`/`upper`/`replace`/`regexp_replace`,
`round`/`abs`, `sum`/`count`/`avg`/`median`, `row_number`,
`date_trunc`/`date_diff`/`date_part`/`strftime`/`strptime`, and
`list_contains`/`list_has_any`/`unnest`. Normal engine signatures still apply.

The engine disables external file/network access and extension autoloading.
Authored queries cannot INSTALL, LOAD, SET, COPY or execute multiple statements.
Dataset reads additionally reject system/cross-catalog relations, qualified
function calls, and table functions in FROM. Query only exposed tables; a function
that exists in DuckDB may still be refused by one of these boundaries.

## Keyword-function limitations in dataset reads

The current catalog validator rejects some unqualified SQL keyword forms because
DuckDB's parser expands them into qualified functions. The message is
`qualified functions are not allowed`; it does not mean you wrote a schema prefix.
These forms work in local queries. For dataset queries use the alternatives below:

| Refused keyword form | Working alternative |
|---|---|
| `trim(text)` | `ltrim(rtrim(text))` for trimming whitespace from both ends |
| `substring(text from start for length)` | `substr(text, start, length)` |
| `extract(year from day)` | `date_part('year', day)` |

```sql
select ltrim(rtrim('  text  ')) as clean,
       substr('hello', 2, 3) as middle,
       date_part('year', date '2026-09-24') as year
```

These are workarounds for the current parser boundary, not a promise that all
overloads are interchangeable. Preserve the intended statistic and string/date
semantics when changing a function.

## Series and JSON-array filters

`generate_series` works as a scalar list combined with `unnest` in both local
and DuckDB dataset queries:

```sql
select unnest(generate_series(1, 3)) as n
```

The FROM form, `select * from generate_series(1, 3)`, works locally but is refused
as a table function in a dataset query. For JSON-array string selections, cast
to a DuckDB list before checking membership:

```sql
select list_contains(cast('["EU","NA"]' as varchar[]), 'EU') as selected
```

The [standalone multi-select example](markup-select.md) binds this pattern to a
reader control. Dataset write grants can further restrict functions in Mutations;
read-query support does not grant write access. Check a real query through
`afbin query`, or use `afbin push --dry-run` to validate the document's queries
against the target dataset before publishing.
