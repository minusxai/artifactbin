---
name: publishing-datasets
description: "Rules and invocations for publishing datasets."
---
## Read first

Register CSV, JSON or GeoJSON files with afbin add --json and import the returned ref:ID with <Import name="d" src="ref:ID" />. A `.geojson` file becomes one row per feature plus a `geometry` column (`afbin help markup-maps`). Push accepts file paths directly. SQL names d.rows for a flat dataset (each catalog table as d.<table>); data="$query" binds the result. A connected Postgres query runs inside it: <Query source="ref:<id>">. A dataset pushed without flags lets everyone read it and lets its owner's pages write it for their accepted members (`afbin help apps`). Add `--policy viewers-write` to the push that CREATES it when everyone who can open the page must be able to write rows without joining: a dataset created without it keeps its default policy, which the flag cannot replace. Finer rules live in the dataset YAML's policy.

Typed user columns use a dataset YAML resource pointing at a `<Dataset>` JSX definition: `afbin help users` contains the complete files and publish command.

Images and PDFs use their native formats; other supported files use file artifacts. Accepted file extensions: mp4, webm, mov; mp3, wav, ogg, m4a, flac; glb, gltf, obj, fbx, stl; png, jpg, jpeg, webp, gif, svg, avif; pdf, txt, csv, json, xlsx; woff, woff2, ttf, otf; zip (default limit 50 MB, FILES__MAX_BYTES). Artifact references use IDs, never local paths. Each registered file retains its identity through preview and publication. Standalone asset replacement reports affected dependents. Read [data authoring](markup-data.md) and [catalogs](databases.md) when using connected or multi-table datasets; connection, table and notebook definitions live in dataset YAML.

<!--bundle:skip-->A stored `<Table>` that declares its `columns` may start with `rows={[]}`: a sheet the people using the page fill in later publishes empty, with its shape, and needs no seed row. A dataset published `--policy viewers-write` stays its OWNER's to re-push — new rows, new columns, the grant kept — as long as the columns the policy names are still there; anyone else with edit access is refused `policy_locked`, and a governed dataset is never reverted, because viewers' rows are in it. Read an earlier version with `afbin pull <id>@<v> --output -` or take a copy with `afbin fork <id>@<v>`, then push the content you want.
<!--/bundle:skip-->

An imported URL is NOT an artifact and never appears in `afbin list`. Imported bytes count against your ACCOUNT's byte quota; a URL is charged once, to whoever first named the URL. Your external URL stays in the document while the server serves its stored copy.

<!--bundle:skip-->CLI creation flags: `afbin push data.csv --access <ACCESS> --policy <POLICY>`; read `afbin push -h` for accepted values. HTTP creates use the separate policy contract in [HTTP API](http-api.md).
<!--/bundle:skip-->
