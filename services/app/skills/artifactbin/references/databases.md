---
name: databases
description: Dataset-bound Postgres credentials, notebook models, whitelisting, queries and migration.
---

## Read first

A dataset can expose multiple schemas, physical tables and notebook model outputs. Postgres connection settings belong to the dataset. Passwords are write-only, encrypted and bound to one exact destination and dataset. Postgres is read-only. Stored datasets can allow row mutations.

## Password, discovery and notebook

Bearer API (browser equivalents add `/my`):
- `POST /api/secrets` with `{value,connection,datasetId?}` returns only `{secret:{id}}`. `connection` is `{host,port,database,username,ssl}`. Use `datasetId` when replacing credentials for an existing dataset.
- `POST /api/datasets/discover` with `{connection,datasetId?}` discovers raw schemas, tables and columns. `connection` includes `passwordSecretId`.
- `POST /api/datasets/notebook/preview` with `{connection,notebook,cellId,datasetId?}` runs one named cell and its dependencies before whitelisting.

MCP equivalents are `create_dataset_secret`, `discover_dataset_source`, and `preview_dataset_notebook`. Dataset editors control its connection, notebook and whitelist. A new secret is required to redirect the destination or replace the password.

Postgres datasets cannot carry their bound password into a fork. Stored datasets remain forkable by readers.

Use a dedicated read-only Postgres login. Query execution uses a read-only transaction, server timeout, result limits and a catalog-restricted SQL compiler. Unsupported syntax/functions fail closed. Preserve AUTH__SECRET across deployments or create replacement password secrets after rotation.

Public deployments block private/loopback destinations. Self-hosted operators may explicitly set `DATASET__ALLOW_PRIVATE_NETWORKS=true` for their database network. Metadata/link-local/multicast destinations remain blocked. Host resolution is pinned and TLS verifies the original hostname.

## Publish a catalog

Use the normal create/update artifact operation, with an object in `dataset`:

```json
{
  "title": "Product analytics",
  "visibility": "private",
  "dataset": {
    "kind": "postgres",
    "connection": {"host":"db.example.com","port":5432,"database":"commerce","username":"reader","ssl":true,"passwordSecretId":"sec_..."},
    "defaultSchema": "analytics",
    "refreshSeconds": 60,
    "notebook": {"cells":[
      {"id":"activity","name":"activity","sql":"select user_id, count(*) as events from public.events group by user_id"}
    ]},
    "tables": [
      {"schema":"analytics","name":"events","source":{"schema":"public","table":"events"},"columns":["user_id","occurred_at"]},
      {"schema":"analytics","name":"activity","modelCellId":"activity","columns":["user_id","events"]}
    ]
  }
}
```

Notebook cells can query every discovered raw table and compose earlier or later named cells through a validated dependency graph. The final whitelist independently selects physical columns and model output columns. Intermediate cells are never queryable by dataset readers. Invalid or cyclic dependencies refuse the save. Models are virtual: no warehouse tables are created.

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

`source` is a literal dataset ID. Runtime SQL names only final-whitelist schema/table identifiers. Parameters come from declared scalar Values, with explicit Postgres type binding.

Stored writes use `<Mutation name="edit" source="<datasetId>">{\`update public.items set status=$_value where id=$_row.id\`}</Mutation>`. The dataset must be writable and the viewer must have edit permission. Postgres writes are unavailable. Dataset editors may change connection settings, notebook cells and the final whitelist, but password values remain write-only.

## Preview and freshness

The UI at `/datasets/new` follows connection → notebook → whitelist; `/datasets/<id>/edit` edits the same canonical dataset definition. The dataset page offers exposed schema/table selection, paginated rows and Refresh.

`POST /a/<id>/tables` takes `{sql,limit?,offset?,refresh?}` and returns `{rows,columns,truncated?,refreshedAt}` after dataset read authorization. `refresh:true` bypasses cached results. `refreshSeconds:0` disables caching; otherwise it is the cache lifetime. External database writes do not emit Artifactbin live events: use Refresh or rerun the document query. Database edits never create dataset definition versions.

## Migration

Existing `ref_<id>` SQL remains supported while migrating. The original alias remains bound to `public.rows` even if more tables are added. New markup should use source.

Operators run `node scripts/dataset-catalog-migrate.mjs --url <origin>` with `ADMIN__SECRET` in the environment. Dry-run is the default; `--apply` performs it. Inspect the report first. The migration updates catalogs and query declarations in heads and retained versions without changing logical version numbers. Multiple-source queries get explicit upstream queries and retain local joins. Unverifiable SQL, history limits and concurrent edits refuse the affected artifact atomically. Reruns skip completed work. No deployment or production migration happens automatically.
