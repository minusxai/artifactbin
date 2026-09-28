# Revised notification demo and acceptance

Use only the revised task server on http://localhost:7001 when root announces it
ready. Old server screenshots and receipts do not verify this implementation.
The root owns server/data; run the branch CLI with `APP__PORT=7001 npm run afbin`.
Keep account IDs, artifacts and receipts in the task's ignored evidence folder.

## Fixture and identities

`scripts/fixtures/mutation-notifications.mjs` exports the typed stored dataset
and complete document. Supply real local `mxmx_test_*` account IDs. The seven rows
are two tasks for one joined recipient, a null assignee, a readable nonmember,
a pending invitee, a former member and a restricted recipient.

Publish generated JSX through the branch CLI. Dataset YAML uses `type: dataset`,
`source: tasks.jsx`; pass the returned dataset ID to the document factory. Record
actual read grants separately from memberships. The joined recipient must accept
an invitation or join and receive approval through the real product. A raw
accepted relation or a viewing grant is not sufficient setup evidence.

The nonmember can read document and datasets but has never joined. The pending
user has not accepted. The former member explicitly joins and leaves. The
restricted recipient joins but cannot read one required source. Notifications
must neither invite nor join any of these people. Record membership before and
after writes. Use `npm run dev:otp -- EMAIL` for local login; never log credentials.

## Deterministic checks

1. Named `tasks_list` read shows seven Todo rows. Named `change_status` for task 1
   with status Done and expected_status Todo changes only that row.
2. Response has mutationRunId. Its status page has **one job** containing all
   three rule names. After completion the joined recipient has **one item** with
   `Task Review pricing is now Done` once and `Please review Review pricing` once.
   Actor attribution is separate. Duplicate rules do not create duplicate text.
3. Simulate a lost successful mutation response at the internal test seam; retry
   the same original CLI command/arguments and operation key. Run, job, item and
   dataset version stay the same. A deliberate new action creates a new run.
4. `bulk_status` from Todo to Done changes six rows. Exactly one eligible recipient
   receives the `2 tasks are now Done` summary. Null, nonmember, pending, left and
   restricted users receive nothing. The query reads current state, so the two
   tasks include task 1 already completed in step 1.
5. Successful `zero_match` with task_id 999 creates one job, no item. Guarded
   `change_status` for task_id 999 fails, with no run/job and unchanged rows.
6. `repairable` with task_id 1 and empty status commits the row, then fails the
   job. Its valid sibling rule must not publish a partial notification. Repair
   current data through a separate mutation. Retry the failed job in the status
   UI: one combined item, same original run, and no further dataset version bump.
7. Membership/access are live: leave or revoke a required source before job
   publication or inbox delivery. The recipient is excluded without undoing the
   mutation. Restore eligibility only through explicit product actions; do not
   assume old notifications are backfilled.
8. Exercise current compiled-reader buttons and status/retry links. On isolated
   writable data, test row action and local table changed→reload initial. A
   headless row action must refuse with session guidance before writing.
9. Before handoff deliberately reset the demo to Todo, read it back, and record
   the new reset run separately so the fresh default button is usable.

Query/run-status API calls may be internal deterministic assertions; agents use
`npm run afbin` and visible UI. UI scripts must use accessible controls and verify
persisted state, not sleeps or source strings. Never test writes on an original
user artifact: a local fork draft can retain its data references. Copy writable
datasets, replace Imports and publish the isolated page before testing.

## Source matrix

The runtime owner verifies the existing query interface for flat uploaded data,
stored multi-table/model catalogs, named upstream results, and connected Postgres.
Use Notify's optional `source="ref:ID"` exactly as Query's native source path.
Postgres cases must exercise native SQL and a real typed recipient array; do not
encode lists as JSON strings. Include a source used only by a filter/upstream
query and revoke it. Source failures leave the whole job failed with no partial
items. Connected reads do not imply support for writes to that database.

Real Postgres/container integration belongs in the existing CI gate, coordinated
with the runtime owner. Record each source case actually exercised; a stored-only
local demo is not proof of all sources. Add no new limits or rate policy here.

## Agent behavior eval

Preserve the separate private repository's operation-headless, operation-authoring
and operation-context tasks. Grade actual wire/tool traces and independently read
rows and source/version. Authoring additionally requires the original dataset
version to remain unchanged: restoring rows after unsafe testing cannot pass.
Prior GLM5.3Flash evidence was two passes and an authoring failure; corrected
instructions were not rerun. Run a new paid eval only when root directs it, against
this branch/server, and report model, tasks, failures and provider configuration
separately. Private credentials/results never enter this product repository.
