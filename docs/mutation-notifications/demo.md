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

## Test your own notifications

Sign in, explicitly join the document, have the owner approve the request, and
receive dataset edit access. Choose a Task ID and click **Assign selected task to
me**; verify your account appears as assignee and the status becomes Todo. Click
**Complete selected task** or **Complete this row**, then open the notification
bell. Each completion produces one item containing the status and review messages,
including when the recipient is the person performing the action. Assign again to
reset the task and repeat. Both completion buttons use the same notified mutation.

Before handoff, exercise both buttons as a joined non-owner in a real browser,
verify one new inbox item per completion and persistence after refresh. Preserve
other users' rows by reserving a separate QA row. Seeing enabled buttons or a
completed job alone is not evidence of inbox delivery.

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
The revised branch was evaluated once with Pi / Fireworks GLM 5.3 Flash against
root7001 using the branch CLI and teaching. All three tasks passed the actual
wire-route, independent final-state and source/version checks:

| Task | Turns | Agent time | Result |
| --- | ---: | ---: | --- |
| Existing artifact headless update | 12 | 40.5 s | Named query/write; only task 1 changed; no sessions/source edits |
| New action authoring | 33 | 84.6 s | Browser QA used a separate writable dataset and published page; original dataset version unchanged |
| Row/local context | 11 | 33.9 s | Browser row 2 action persisted; scratch changed then reset on reload; definitions unchanged |

The harness reported $0.228234 total; this is not a provider billing receipt.
Limits were 40 turns, 600 seconds and $3 per task, concurrency one, with no retry
or baseline sweep. The earlier implementation's two-pass/authoring-fail result
remains historical evidence; it is not substituted for this new three-pass run.
The private scorer's original-dataset-version guard was preserved without edits.

## Verified local handoff (2026-09-29)

Open [the demo](http://localhost:7001/a/i7L7bD). Its dataset is `9UMrTO`.
The actor is `mxmx_test_notify_v2_actor@example.com`; the joined recipient is
`mxmx_test_notify_v2_recipient@example.com`. Sign in at the local `/login` page.
From the running root checkout, `npm run dev:otp -- EMAIL` reads that account's
local code; do not put codes or credentials in this document. Use the actor for
the mutation button and the recipient for the inbox.

Actual compiled-reader UI verified one successful write/status link, one job with
three rules, and one recipient item containing two distinct messages. Real join
requests, owner approvals and leaving established the membership fixtures.
Nonmember, pending, former-member and source-restricted accounts each had zero
mutation items. The CLI smoke verified bulk six-row updates, zero-row success,
guarded refusal without a dataset version change, and a dropped-response retry
with the same run/version. A bad notification output committed the mutation but
published no sibling partial item; UI retry after a separate repair produced one
combined item without a further dataset write (version seven stayed seven).

The demo was then intentionally reset: all seven rows are Todo at dataset version
eight. Reset run `96f829f4c88e7065fdd3d8e1b00f916a1cd6e4d6ba4fbbfac86dce49b4777d2c`
is separate evidence; the default task-1 button is ready to use again.

Task-local evidence lives under `.agent/`: `demo/smoke.json`,
`initial-query.jsonlog`, `joined-members.jsonlog`, `after-retry.jsonlog`,
`reset.jsonlog`, `final-query.jsonlog`, and `paid-routing-glm53/` (three task
ledgers, transcripts and score rows). Browser screenshots and network assertions
are in the E worktree's report. These ignored files are evidence, not fixtures
required to run the product.

The real PostgreSQL gate is CI-only. Its first integrated run caught an incorrect
stored-trigger creation payload before reaching native notification assertions;
the payload was corrected to the established dataset create shape. Local syntax
checks alone do not establish that gate passes; use the final integrated CI
result for native PostgreSQL, typed arrays, notebook models and source authority.
