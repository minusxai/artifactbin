---
name: databases
description: Dataset-bound Postgres credentials, notebook models, whitelisting, queries and migration.
---

## Read first

A dataset can expose multiple schemas, physical tables and notebook model outputs. Postgres connection settings belong to the dataset. Passwords are write-only, encrypted and bound to one exact destination and dataset. Postgres is read-only. Stored datasets can allow row mutations.

## Password, discovery and notebook

A connected dataset is a dataset resource whose `source` names a `.jsx` definition file holding one `<Dataset>` root. The password never enters the definition or the YAML: run `afbin push dataset.yaml --secret-env PGPASSWORD` and the CLI stores the secret for that exact connection, then writes the returned `passwordSecretId` into the definition. Replace a password the same way; a bound secret cannot be reused for another dataset.

- `afbin list --type table --in dataset.yaml` discovers raw schemas, tables and columns for the definition's connection.
- `afbin query dataset.yaml --name <cell>` runs one notebook cell and its dependencies before whitelisting; `afbin query dataset.yaml` reads the exposed tables.
- `afbin pull <id> --type dataset` retrieves the current definition; `afbin push` publishes it conditionally.

Failures report `dataset_error` with `details`: `400` invalid input/query, `403` credentials or access out of scope, `404` unknown or unreadable dataset.

Postgres datasets cannot carry their bound password into a fork. Stored datasets remain forkable by readers.

Use a dedicated read-only Postgres login. Query execution uses a read-only transaction, server timeout, result limits and a catalog-restricted SQL compiler. Unsupported syntax/functions fail closed. Preserve AUTH__SECRET across deployments or create replacement password secrets after rotation.

Public deployments block private/loopback destinations. Self-hosted operators may explicitly set `DATASET__ALLOW_PRIVATE_NETWORKS=true` for their database network. Metadata/link-local/multicast destinations remain blocked. Host resolution is pinned and TLS verifies the original hostname. An operator whose system resolver returns a split-horizon private address may set `DATASET__DNS_SERVERS` to a comma-separated list of literal DNS server IPs. That resolver override applies only to dataset PostgreSQL hosts; unset or empty keeps the operating system resolver.

## Publish a catalog

Use static dataset markup with the secret ID returned by push:

```jsx
<Dataset kind="postgres" defaultSchema="models" refreshSeconds={60}>
  <Connection host="db.example.com" port={5432} database="commerce"
    username="reader" ssl={true} passwordSecretId="sec_..." />
  <Notebook>
    <SqlCell id="raw" name="raw_events"
      sql="SELECT user_id FROM public.events" />
    <SqlCell id="activity" name="activity"
      sql="SELECT user_id, count(*) AS events FROM raw_events GROUP BY user_id" />
  </Notebook>
  <Table schema="models" name="activity" modelCellId="activity"
    columns={["user_id", "events"]} />
</Dataset>
```

Publish the definition:

- Create: write `orders.yaml` with `type: dataset`, `source: orders.jsx` and `visibility: private`, then `afbin push orders.yaml`.
- Read back: `afbin pull <id> --type dataset --output orders.yaml` writes the canonical definition beside the YAML for an authorized editor.
- Update: edit `orders.jsx`, then `afbin push orders.yaml`; the push is conditional on the observed version and sends the complete replacement definition.

Connection configuration contains only the secret ID, never the password.

Cells query qualified raw tables such as `public.events` and reference **earlier cells only** by name. Later references and cycles are rejected. Cell IDs must be stable and unique; names must be unique. Models are virtual, not warehouse tables.

The final whitelist selects physical columns or model output columns independently of notebook inputs. The example exposes only `models.activity`; its `raw_events` helper and `public.events` source remain unavailable to readers. To expose physical columns directly, add a table such as `<Table schema="public" name="events" sourceSchema="public" sourceTable="events" columns={["user_id"]} />`. In the UI, a cell's Expose checkbox and whitelist tree entry are one selection.

Structured `CatalogInput` objects remain accepted in `dataset`, including `kind:"stored"` tables with `rows`. Omit rows to keep data; new columns start null. Restate rows to drop/retype one. Arrays/CSV remain the single-table `rows` case.

The default schema is fixed: bare `events` always resolves there. Updates keep optimistic concurrency and history.

## Queries and mutations

A connected Postgres dataset is never imported; a query runs inside it, in Postgres SQL:

```jsx
<Helmet>
  <Value name="user" type="number" />
  <Query name="activity" source="ref:pgs123">
    {`select * from models.activity where $user is null or user_id=$user`}
  </Query>
</Helmet>
<DataTable data="$activity" />
```

`source` is a literal dataset ID. Its SQL names only final-whitelist tables; `$params` bind with Postgres types. Other queries read its result by name ([SQL](markup-sql.md)).

A stored multi-table dataset is imported once and read by table: `<Import name="shop" src="ref:<id>" />`, then `shop.items`; a `<Mutation>` writes `update shop.items set …`. New stored datasets default to public reads and writes through their owner’s artefacts. Accepted members can run saved actions; use `afbin invite <ref> @username` or People → Add people. [Apps](apps.md) explains version 2 grants, joining and mentions. Existing version 1 datasets keep their policies; their legacy writable setting is `--access readwrite --policy viewers-write`. To inspect or change policies, `afbin pull <id> --type dataset --output tasks.yaml` writes tracked settings beside the rows. Optional table/column/row restrictions narrow grants. Postgres writes are unavailable.

## Preview and freshness

Push datasets with `afbin push` ([datasets](publishing-datasets.md)). Run notebook cells before exposing outputs; edits invalidate downstream previews. Draft previews show up to 50 rows.

`POST /a/<id>/tables` takes `{sql,limit?,offset?,refresh?}` and returns `{rows,columns,truncated?,refreshedAt}` after dataset read authorization, and queries only final-whitelist tables and columns. It cannot query hidden notebook helpers or unexposed raw sources. `refresh:true` bypasses cached results. `refreshSeconds:0` disables caching; otherwise it is the cache lifetime. External database writes do not emit Artifactbin live events: use Refresh or rerun the document query. Database edits never create dataset definition versions.

## Migration

A document reads an imported dataset's tables as `d.<table>`; a flat upload has one, `d.rows`.

Manual data migrations are an operator's job, with server shell access; there is no HTTP endpoint or CLI command. Back up and preview first, validate document data, and apply with reviewed snapshot fingerprints. Stop the app before opening its PGLite directory. Startup schema updates are separate.

Stored `Table.columns` accepts `{name,type,choices?,constraints?}` declarations, including native `user` fields. See [user fields](databases-users.md) for membership arrays, `self`, automatic pickers and server validation. `choices`: 1–100 distinct typed suggestions for policy pickers, e.g. `{name:"status",type:"string",choices:["todo","doing","done"]}`. Enforce allowed writes with policy checks. Postgres whitelist columns remain strings.

## Dates and timestamps

`date` is a calendar date (`YYYY-MM-DD`). `timestamp` is an instant: values are
stored and returned as UTC ISO 8601 with `Z`, at millisecond precision. Accept
ISO dates/datetimes with or without an offset, or epoch milliseconds; a missing
timezone means UTC and a date means midnight UTC. Invalid values name the column.
The current instant in SQL is `$_now`. DataTable shows timestamps in the reader's
timezone. A DatePicker bound to a timestamp selects a date and writes midnight
UTC; selecting a new date discards the previous time of day.
