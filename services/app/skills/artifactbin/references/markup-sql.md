---
name: markup-sql
description: The SQLite a document writes, how it differs from DuckDB and Postgres, and every function it may call.
---
## Read first

A document's SQL is SQLite. A `<Query>` is one SELECT; a `<Mutation>` is one
INSERT, UPDATE or DELETE. It reads `<import>.rows` (`sales.rows`), declared
queries and table values by name, and the built-in tables `_me` and `_members`.
`$name` binds a value; it is never spliced into the text. Dates are ISO text
(`2026-09-30`), timestamps ISO text in UTC (`2026-09-30T10:30:00.000Z`), lists
JSON arrays.

```sql
select date('2026-09-30T10:15:00Z') as day,
       date_add('2026-09-30', 1, 'day') as tomorrow,
       date_part('year', '2026-09-30') as year,
       date_format('2026-09-30', '%a %d %b') as label,
       7 / 2 as whole, 7 * 1.0 / 2 as exact,
       'Apple' like 'a%' as matched
```

## Write this, not that

| Write | Not | Why |
|---|---|---|
| `date(x)` | `cast(x as date)`, `x::date` | SQLite has no date type: the cast reads '2026-09-30' as 2026, so it is refused, and `::` does not parse |
| `strftime('%Y-%m-%dT%H:%M:%fZ', x)` | `cast(x as timestamp)` | the same, for a timestamp |
| `$_now`, `date(to_timezone($_now, $_tz))` | `now()`, `current_date`, `date('now')` | the time is an input, identical in the browser and on the server |
| `date_add(d, 1, 'day')` | `d + interval '1 day'` | SQLite has no intervals |
| `date_part('year', d)` | `extract(year from d)` | |
| `count(*) * 1.0 / n` | `count(*) / n` | `/` between two integers drops the fraction |
| `x like 'a%'` | `x ilike 'a%'` | LIKE already ignores case (for ASCII) |
| `'2026-01-01'` | `date '2026-01-01'` | a date is its text |
| `select value from json_each(list)` | `unnest(list)` | a list is JSON |
| `list_contains(list, x)`, `json_group_array(x)` | `x = any(list)`, `array_agg(x)` | |
| `date_parse(text, '%d/%m/%Y')` | `strptime(text, …)` | |

Number columns and number values are REAL, so `revenue / 2` keeps its
fraction. Integers come from literals, `count(*)`, `length()`, `date_diff`,
`date_part` and a recursive CTE's counter: divide those with `* 1.0 /`. The
other habits in the table are refused at publish, with the SQLite to write
instead; integer division is valid SQL, so only you can catch it.

## Dates, series and lists

Compare dates as text (`day >= '2026-09-01'`). A series is a JSON list read as
a table with `json_each` (with `json_tree`, the only table functions a document may use):

```sql
select value as day, dayname(value) as weekday
from json_each(date_series('2026-09-28', '2026-10-02'))
where dayofweek(value) not in (0, 6)
```

A reader's local day is `date(to_timezone($_now, $_tz))`. A multi-select stores
a JSON list; test membership with `list_contains`:

```sql
select list_contains('["EU","NA"]', 'EU') as selected
```

## The library

The functions the engine adds to SQLite, the same in the browser, on the server
and in the CLI:

[[ sqlFunctionTable ]]

`uuid()` gives a new row its id; like `random()`, it is allowed only in a
`<Mutation>`, because a query must give the same rows every time it runs.

SQLite's own functions a statement may call: [[ sqliteFunctions ]].
Any other function is refused by name.

## Connected Postgres

`<Query name source="ref:<id>">` runs inside a connected Postgres database, on
the server, in Postgres SQL: `::`, `interval` and `now()` are Postgres's there.
It reads the tables the dataset exposes; its result is rows like any query's,
which SQLite queries then read by name. [Catalogs](databases.md).

## Check before publishing

`afbin push report.jsx --dry-run` compiles every query against the real columns
without publishing. `afbin query report.jsx --name slots` runs one query and
what it reads. A dataset's own SQL (`afbin query <dataset-id> --input q.sql`)
names its table `rows`; a document names it through its import, `sales.rows`.
