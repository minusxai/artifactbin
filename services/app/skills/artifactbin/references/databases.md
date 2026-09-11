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

Dataset secret, discovery and notebook failures report `dataset_error` with a `details` array. `400` means invalid or refused input/query; `403` means credentials or access are outside the permitted scope; `404` means the dataset is unknown or unreadable.

Postgres datasets cannot carry their bound password into a fork. Stored datasets remain forkable by readers.

Use a dedicated read-only Postgres login. Query execution uses a read-only transaction, server timeout, result limits and a catalog-restricted SQL compiler. Unsupported syntax/functions fail closed. Preserve AUTH__SECRET across deployments or create replacement password secrets after rotation.

Public deployments block private/loopback destinations. Self-hosted operators may explicitly set `DATASET__ALLOW_PRIVATE_NETWORKS=true` for their database network. Metadata/link-local/multicast destinations remain blocked. Host resolution is pinned and TLS verifies the original hostname. An operator whose system resolver returns a split-horizon private address may set `DATASET__DNS_SERVERS` to a comma-separated list of literal DNS server IPs. That resolver override applies only to dataset PostgreSQL hosts; unset or empty keeps the operating system resolver.

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

- Create: write `orders.yaml` with `type: dataset`, `source: orders.jsx` and `visibility: private`, then `afbin push orders.yaml`.
- Read back: `afbin pull <id> --type dataset --output orders.yaml` writes the canonical definition beside the YAML for an authorized editor.
- Update: edit `orders.jsx`, then `afbin push orders.yaml`; the push is conditional on the observed version and sends the complete replacement definition.

The visual editor edits this same `dataset` string; read-back uses `markup`. Connection configuration contains only the secret ID, never the password.

Cells query qualified raw tables such as `public.events` and reference **earlier cells only** by name. Later references and cycles are rejected. Cell IDs must be stable and unique; names must be unique. Models are virtual, without warehouse tables.

The final whitelist selects physical columns or model output columns independently of notebook inputs. The example exposes only `models.activity`; its `raw_events` helper and `public.events` source remain unavailable to readers. To expose physical columns directly, add a table such as `<Table schema="public" name="events" sourceSchema="public" sourceTable="events" columns={["user_id"]} />`. In the UI, a cell's Expose checkbox and its whitelist tree entry control the same selection.

Structured `CatalogInput` objects remain accepted in `dataset`, including `kind:"stored"` tables with `rows`. Omit rows on an existing table to retain its data. Arrays/CSV remain the single-table `public.rows` case.

The default schema is fixed after creation. A bare `events` resolves only there; adding another schema/table never changes its meaning. New catalog versions retain ordinary optimistic concurrency (`expectedVersion`) and artifact version history.

## Queries and mutations

```jsx
<Helmet>
  <Value name="user" type="number" />
  <Query name="activity" source="ref:abc123">
    {`select * from models.activity where $user is null or user_id=$user`}
  </Query>
</Helmet>
<DataTable data="$activity" />
```

`source` is a literal dataset ID. Runtime SQL names only final-whitelist schema/table identifiers. Parameters come from declared scalar Values, with explicit Postgres type binding.

Stored writes use `<Mutation name="edit" source="ref:abc123">{\`update public.items set status=$_value where id=$_row.id\`}</Mutation>`. Writable datasets use one data policy for everyone with view access (Hasura role `viewer`); sharing sets the audience. Editors and owners configure rules with `set_dataset_policy` and read them with `get_dataset_policy`. No policy means editor-only writes. Postgres writes are unavailable.

## Preview and freshness

Create at `/datasets/new`; edit at `/a/<id>/edit` or a pretty artifact address plus `/edit`. Tabs separate Data actions, Data preview, and Source & models. Run notebook cells before exposing outputs; edits invalidate downstream previews. Run SQL executes only on request. Saved data supports pagination and refresh; draft previews show up to 50 rows.

`POST /a/<id>/tables` takes `{sql,limit?,offset?,refresh?}` and returns `{rows,columns,truncated?,refreshedAt}` after dataset read authorization, and queries only final-whitelist tables and columns. It cannot query hidden notebook helpers or unexposed raw sources. `refresh:true` bypasses cached results. `refreshSeconds:0` disables caching; otherwise it is the cache lifetime. External database writes do not emit Artifactbin live events: use Refresh or rerun the document query. Database edits never create dataset definition versions.

## Migration

Use `source="ref:<id>"` to choose the dataset and its exposed table names in SQL. Flat uploads expose `public.rows`.

Operators run `node scripts/dataset-catalog-migrate.mjs --url <origin>` with `ADMIN__SECRET` in the environment. Dry-run is the default; `--apply` performs it. Inspect the report first. The migration updates catalogs and query declarations in heads and retained versions without changing logical version numbers. Multiple-source queries get explicit upstream queries and retain local joins. Unverifiable SQL, history limits and concurrent edits refuse the affected artifact atomically. Reruns skip completed work. No deployment or production migration happens automatically.
