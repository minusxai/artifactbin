---
name: databases
description: Postgres connections, named dataset tables, SQL models, permissions and migration.
---

## Read first

A dataset can expose multiple schemas and named tables. Its source is stored rows or a Postgres connection. Connections hold encrypted credentials server-side; datasets hold an exposed catalog and ordinary artifact sharing. Postgres is read-only. Stored datasets can allow row mutations.

## Connections

Bearer API (browser equivalents use `/api/my/connections`):
- `GET /api/connections` — list your connections; never returns passwords.
- `POST /api/connections` — create `{name,host,port,database,username,password,ssl}`. Port defaults to 5432; ssl defaults true with certificate verification.
- `PUT /api/connections/<id>` — replace connection settings; omitted/blank password retains it.
- `POST /api/connections/<id>/test` — discover readable schemas, tables and columns.

MCP equivalents: `list_connections`, `create_connection`, `update_connection`, `test_connection`. A connection is owner-managed. Sharing a dataset never reveals credentials or grants access to the rest of the connection.

Forking a Postgres dataset requires ownership of its connection; read or edit access to the dataset alone is insufficient. This prevents a copy from retaining connection access after the original dataset share is revoked. Stored datasets remain forkable by readers.

Use a dedicated read-only Postgres login. Query execution also uses a read-only transaction, server timeout, result limits and a catalog-restricted SQL compiler. Unsupported syntax/functions fail closed. Errors use `dataset_error` with details; inaccessible connections return 404. Connection credentials are encrypted using a key derived from AUTH__SECRET; preserve that secret across deployments or re-enter credentials after rotation.

Public deployments block private/loopback destinations. Self-hosted operators may explicitly set `DATASET__ALLOW_PRIVATE_NETWORKS=true` for their database network. Metadata/link-local/multicast destinations remain blocked. Host resolution is pinned and TLS verifies the original hostname.

## Publish a catalog

Use the normal create/update artifact operation, with an object in `dataset`:

```json
{
  "title": "Product analytics",
  "visibility": "private",
  "dataset": {
    "kind": "postgres",
    "connectionId": "conn_...",
    "defaultSchema": "analytics",
    "refreshSeconds": 60,
    "tables": [
      {"schema":"analytics","name":"events","source":{"schema":"public","table":"events"},"columns":["user_id","occurred_at"]},
      {"schema":"analytics","name":"activity","sql":"select user_id, count(*) as events from analytics.events group by user_id"}
    ]
  }
}
```

Every source table has an explicit column list. New database objects are excluded until selected. Logical schema/table names need not match physical names. SQL models query exposed tables or other models; output columns are discovered on save. Invalid or cyclic dependencies refuse the save. Models are virtual: no warehouse tables are created.

For stored tables, use `kind:"stored"` and entries such as `{"schema":"public","name":"items","rows":[{"id":1,"status":"todo"}]}`. Omit rows on an existing table to retain its data. Arrays/CSV remain accepted as the single-table `public.rows` case.

The default schema is fixed after creation. A bare `events` resolves only there; adding another schema/table never changes its meaning. New catalog versions retain ordinary optimistic concurrency (`expectedVersion`) and artifact version history.

## Queries and mutations

```jsx
<Helmet>
  <Value name="user" type="number" />
  <Query name="activity" source="<datasetId>">
    {`select * from analytics.activity where $user is null or user_id=$user`}
  </Query>
</Helmet>
<DataTable data="$activity" />
```

`source` is a literal dataset ID. SQL names exposed schema/table identifiers. Parameters come from declared scalar Values, with explicit Postgres type binding. A sourced query runs on that dataset's engine; it cannot directly reference another document query. A later query without source may consume its result through the existing local dataflow.

Stored writes use `<Mutation name="edit" source="<datasetId>">{\`update public.items set status=$_value where id=$_row.id\`}</Mutation>`. The dataset must be writable and the viewer must have edit permission. Postgres writes are unavailable. Dataset editors may edit models within existing source exposure; only the dataset owner with connection authority may expand exposure or change its connection.

## Preview and freshness

The UI at `/datasets/new` creates connections/catalogs; `/datasets/<id>/edit` edits them. The dataset page offers schema/table selection, paginated rows and Refresh.

`POST /a/<id>/tables` takes `{sql,limit?,offset?,refresh?}` and returns `{rows,columns,truncated?,refreshedAt}` after dataset read authorization. `refresh:true` bypasses cached results. `refreshSeconds:0` disables caching; otherwise it is the cache lifetime. External database writes do not emit Artifactbin live events: use Refresh or rerun the document query. Database edits never create dataset definition versions.

## Migration

Existing `ref_<id>` SQL remains supported while migrating. The original alias remains bound to `public.rows` even if more tables are added. New markup should use source.

Operators run `node scripts/dataset-catalog-migrate.mjs --url <origin>` with `ADMIN__SECRET` in the environment. Dry-run is the default; `--apply` performs it. Inspect the report first. The migration updates catalogs and query declarations in heads and retained versions without changing logical version numbers. Multiple-source queries get explicit upstream queries and retain local joins. Unverifiable SQL, history limits and concurrent edits refuse the affected artifact atomically. Reruns skip completed work. No deployment or production migration happens automatically.
