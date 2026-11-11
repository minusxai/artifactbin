---
name: governed-data
description: "Read before a page shows live rows from a company warehouse on a server that runs MinusX (its /api/server names minusx): discover a group's connections, catalog and context, declare 'minusx' in a function's secrets, bind it, handle data_access_denied."
---
## Read first: does this server govern its data?

Only on a combined installation: `GET /api/server` answers `installation_id` and
`minusx.base_url`. There, live warehouse sources are governed by MinusX: each viewer reads them
as themselves, under the one group the page is pinned to, with exactly the tables, columns and
models that group may see. Anywhere else
`'minusx'` refuses publish with `minusx_not_configured`: use a dataset, or `caps.db` with
`'postgres'` or `'mysql'` ([functions](functions.md)).

## Discover

Pick the group the analysis is for (one you are a direct member of; `node scripts/groups.mjs
list`), then ask MinusX what it may read:

```bash
node scripts/minusx.mjs connections --group finance
node scripts/minusx.mjs catalog --group finance --connection conn_finance
node scripts/minusx.mjs context --group finance --connection conn_finance
```

`catalog` lists only what that group may query; models are in schema `_views`
(`select month, net_revenue_usd from _views.monthly_revenue`). `context` gives the group's docs,
metric definitions and model versions. Prefer a model
to raw tables. Everything runs under that one group, never the union of your groups.

## Declare and bind

A function file declares the connection name and reads it with `caps.db`:

```ts
export const secrets = {FIN: 'minusx'};
export default {
  async revenue(_input, _principal, caps) {
    const db = await caps.db('FIN');
    try {
      return (await db.query('select month, net_revenue_usd from _views.monthly_revenue order by month')).rows;
    } finally { await db.end(); }
  },
};
```

Publish the page, then pin FIN to the connection and group, once:

```bash
node scripts/minusx.mjs bind PAGE12 --name FIN --group finance --connection conn_finance
```

The server checks that you are a direct member of the group and that the group can see the
connection, and stores only `{connection_id, group_id}`. Every later publish checks it again
for whoever publishes; to change the group or connection, bind again. A group-owned page
(`publish --group`) may carry a binding: any editor of the owning group who is a direct member
of the pinned group binds it.

## Who reads, and when they cannot

Each call runs as its viewer: the server asks MinusX for a short-lived session for that person
under the pinned group, and MinusX checks their membership and the group's rules on every
statement. A viewer outside the group, or a signed-out reader, gets the page with a
`data_access_denied` error (`e.code`) from `caps.db`, never your rows: catch it and show a
clear state. Uncaught, the call answers `500 {"error":"backend_failed","message":"data_access_denied: FIN"}`.
`data_unavailable` means MinusX did not answer: show that the data is unavailable and retry
later. Sharing a page with the group grants no data access by itself.

## Limits

No schedules here: recurring refreshes belong to MinusX jobs, and a page `schedule` export is
refused with `schedules_owned_by_minusx` when MinusX owns schedules (so is a fork, trash
restore or revert that would bring one back). Reads only: the governed
session refuses writes. Per run the `caps.db` limits apply (4 connections, 16 MiB in).
