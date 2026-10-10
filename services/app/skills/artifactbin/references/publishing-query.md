---
name: publishing-query
description: "Rules and invocations for publishing query."
---
## Read first

Use query to read dataset rows or run a document's declared queries; local files run locally when their inputs are present. The SQL engine (SQLite) is built in: queries run in the CLI process, offline, and send no local data. Declare <Import src="ref:<id>"> (a connected Postgres query: <Query source="ref:<id>">); SQL names tables. Local values and query bindings are separate from artifact references. For existing artifacts, prefer `afbin query ID --name tasks` for named reads and `afbin query ID --write --name change_status --param task_id=123 --param status=Done` for named mutations. Inspect the declared names and parameters first. Direct dataset writes also require --write. Sessions are for browser/UI testing of newly authored actions, page-local state and unsupported row/cell context. An uncertain write must recover its existing operation; never repeat it as a fresh action.
