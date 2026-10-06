---
title: CLI filters
description: Supported afbin list, comment and log filters.
---
# CLI filters

Pass filters as `--filter FIELD=VALUE`. Repeat `--filter` to combine different
fields. Each command accepts only the fields listed for its collection.

## `afbin list`

- `search=<text>` searches listed resource metadata. For example:
  `afbin list --filter search=Quarterly`.
- `visibility=private|unlisted|public` limits results to one visibility.
- `relationship=all|owned|shared` limits results by your relationship to the
  resource.

For example, list private resources you own:

```sh
afbin list --filter visibility=private --filter relationship=owned
```

## `afbin comment`

- `state=open|resolved|all` selects open threads, resolved threads or both.
- `author=<label-or-user-id>` selects threads with a comment from that author.

For example, include settled threads when reviewing a document:

```sh
afbin comment report.jsx --filter state=all
```

## `afbin log`

- `author=<author>` limits versions to one author.
- `since=<ISO-8601 date or timestamp>` sets the start of the interval.
- `until=<ISO-8601 date or timestamp>` sets the end of the interval.

For example, list versions changed during one day:

```sh
afbin log report.jsx --filter since=2026-01-01 --filter until=2026-01-02
```

Use each field at most once per command. Invalid fields and enum values are
rejected with the supported fields or values.
