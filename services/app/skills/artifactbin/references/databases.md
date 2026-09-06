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

For a new dataset, omit `datasetId`: the secret remains pending and belongs to its creator. Use that reference for discovery and notebook previews, then publish the dataset to bind it. A bound secret cannot be reused for another dataset. For an existing dataset, pass its `datasetId` when creating a replacement secret and on discovery/preview requests; update the definition with the new reference. Changing any connection setting requires a matching new secret. Send plaintext only as `value` to the secret endpoint, never in dataset markup.

MCP equivalents are `create_dataset_secret`, `discover_dataset_source`, and `preview_dataset_notebook`. Dataset editors control its connection, notebook and whitelist. A new secret is required to redirect the destination or replace the password.

Dataset secret, discovery and notebook operation failures return `error: "dataset_error"` with a `details` array. HTTP status `400` means invalid or refused input/query; `403` means credentials or access are outside the permitted scope; `404` means the dataset is unavailable to the actor; `503` means stored credentials cannot be decrypted, for example after key rotation. Earlier HTTP authentication, body validation and not-found checks can return other error codes; inspect the status and details together.

Postgres datasets cannot carry their bound password into a fork. Stored datasets remain forkable by readers.

Use a dedicated read-only Postgres login. Query execution uses a read-only transaction, server timeout, result limits and a catalog-restricted SQL compiler. Unsupported syntax/functions fail closed. Preserve AUTH__SECRET across deployments or create replacement password secrets after rotation.

Public deployments block private/loopback destinations. Self-hosted operators may explicitly set `DATASET__ALLOW_PRIVATE_NETWORKS=true` for their database network. Metadata/link-local/multicast destinations remain blocked. Host resolution is pinned and TLS verifies the original hostname.

## Publish a catalog

The canonical definition is static dataset markup. Replace the example secret ID with the ID returned by the secret endpoint:

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

Use the full markup string as `definition` in the normal artifact operations:

- Create: `POST /api/artifacts` with `{title, visibility: "private", dataset: definition}`.
- Read back: `GET /api/artifacts/<id>` returns the canonical definition in `markup` and its `version` to an authorized editor.
- Update: `PUT /api/artifacts/<id>` with `{dataset: editedDefinition, expectedVersion: version}`. Send the complete replacement definition.

The write field is `dataset` with a string value; `markup` is the read-back field. The visual editor reads and writes this same definition. Only the secret ID is stored in its connection configuration, never the password.

Notebook cells can query discovered raw tables using qualified names such as `public.events` and reference **earlier cells only** by name. Later-cell references and cycles are rejected. Each cell needs a stable unique ID and a unique name. Models are virtual: no warehouse tables are created.

The final whitelist selects physical columns or model output columns independently of notebook inputs. The example exposes only `models.activity`; its `raw_events` helper and `public.events` source remain unavailable to readers. To expose physical columns directly, add a table such as `<Table schema="public" name="events" sourceSchema="public" sourceTable="events" columns={["user_id"]} />`. In the UI, a cell's Expose checkbox and its whitelist tree entry control the same selection.

Structured catalog objects in `dataset` are still accepted for compatibility. For stored tables, use `kind:"stored"` and entries such as `{"schema":"public","name":"items","rows":[{"id":1,"status":"todo"}]}`. Omit rows on an existing table to retain its data. Arrays/CSV remain accepted as the single-table `public.rows` case.

The default schema is fixed after creation. A bare `events` resolves only there; adding another schema/table never changes its meaning. New catalog versions retain ordinary optimistic concurrency (`expectedVersion`) and artifact version history.

## Queries and mutations

```jsx
<Helmet>
  <Value name="user" type="number" />
  <Query name="activity" source="<datasetId>">
    {`select * from models.activity where $user is null or user_id=$user`}
  </Query>
</Helmet>
<DataTable data="$activity" />
```

`source` is a literal dataset ID. Runtime SQL names only final-whitelist schema/table identifiers. Parameters come from declared scalar Values, with explicit Postgres type binding.

Stored writes use `<Mutation name="edit" source="<datasetId>">{\`update public.items set status=$_value where id=$_row.id\`}</Mutation>`. The dataset must be writable and the viewer must have edit permission. Postgres writes are unavailable. Dataset editors may change connection settings, notebook cells and the final whitelist, but password values remain write-only.

## Preview and freshness

The UI at `/datasets/new` follows Connection → Data models notebook → Whitelist → Table view / Run SQL. `/datasets/<id>/edit` edits the same canonical definition. Run cells to inspect output columns before exposing them; changing a cell invalidates affected downstream output previews. The final SQL editor runs only when you choose Run SQL. Saved datasets offer exposed schema/table selection, paginated rows and Refresh; draft previews are limited to 50 rows without pagination.

`POST /a/<id>/tables` takes `{sql,limit?,offset?,refresh?}` and returns `{rows,columns,truncated?,refreshedAt}` after dataset read authorization, and queries only final-whitelist tables and columns. It cannot query hidden notebook helpers or unexposed raw sources. `refresh:true` bypasses cached results. `refreshSeconds:0` disables caching; otherwise it is the cache lifetime. External database writes do not emit Artifactbin live events: use Refresh or rerun the document query. Database edits never create dataset definition versions.

## Migration

Existing `ref_<id>` SQL remains supported while migrating. The original alias remains bound to `public.rows` even if more tables are added. New markup should use source.

Operators run `node scripts/dataset-catalog-migrate.mjs --url <origin>` with `ADMIN__SECRET` in the environment. Dry-run is the default; `--apply` performs it. Inspect the report first. The migration updates catalogs and query declarations in heads and retained versions without changing logical version numbers. Multiple-source queries get explicit upstream queries and retain local joins. Unverifiable SQL, history limits and concurrent edits refuse the affected artifact atomically. Reruns skip completed work. No deployment or production migration happens automatically.
