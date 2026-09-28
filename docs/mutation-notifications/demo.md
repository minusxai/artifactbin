# Task-server notification demo and smoke

Use only the integrated task server; a server lacking notification workers is not a feature demo.
Root owns its process/data; the final handoff names the running port, artifact URL and inbox URL.

## Fixture

`scripts/fixtures/mutation-notifications.mjs` exports a typed dataset and complete document.
Provision local `mxmx_test_*` actor, recipient and outsider accounts. Pass real recipient/outsider
IDs to `notificationDemoDataset`, save it as `tasks.jsx` and a `tasks.yaml` resource with
`type: dataset`, `source: tasks.jsx`, `access: readwrite`. Publish with the branch CLI, then
pass its ID to `notificationDemoDocument` and publish that JSX. Grant the actor and recipient
read access to the document and dataset; leave outsider unable to read the dataset.
Never print credentials. Sign in with the local browser/OTP flow; use `npm run dev:otp`.

All CLI steps use `APP__PORT=<task-port> npm run afbin -- ...`. The shorthand `ID` below is the
published document. Keep the CLI's returned JSON receipts in the task's ignored evidence folder.

## Deterministic acceptance

1. `query ID --name tasks_list --json`: assert four rows, all Todo.
2. `query ID --write --name change_status --param task_id=1 --param status=Done --param expected_status=Todo --json`.
   Assert affected=1 and a nonempty mutationRunId. Read tasks_list; only row 1 changed.
3. Through the authenticated status UI, discover jobs for that run; poll with a bounded deadline
   until completed. The recipient inbox contains exactly one matching item; actor is separate
   from current-state message. The outsider inbox contains none.
4. Test replay using the same stored operation key/receipt in the internal smoke seam, not a new
   CLI command after success (which means a deliberate new run). The response has the same run
   ID and no additional inbox item. A deliberate second action gets a different run ID/item.
5. `bulk_status` with expected_status=Todo and status=Done changes the remaining three rows;
   bulk_summary groups by assignee. Null and ineligible recipients receive nothing. Distinct
   result rows are not automatically deduplicated; SQL GROUP BY controls this summary.
6. `zero_match` with task_id=999 and status=Done succeeds with affected=0; its job completes
   with zero inbox items. An explicit guarded change_status with task_id=999 fails and has no job.
7. `repairable` with task_id=1 and status= (empty) commits the row and fails its job visibly
   because message is empty. Set the current row to Done using another action, then retry the
   failed job in the status UI. It completes under the original run ID, without another write.
8. Open one CLI live session on the document; click Change local value, read scratch_list and
   assert changed, reload and assert initial. Run the Complete this row control and confirm
   persisted state via tasks_list. Verify the named headless row action is refused before writing.
9. On a disposable test-user fork, exercise newly authored actions as its test user and owner;
   then use a guest session on the original to verify identity-bearing controls cannot write.
   Close each session before starting the next. A failed/uncertain script is recovered by its
   session/execution receipt, never blindly resubmitted.

The automated smoke should assert persisted state, actual job discovery and browser controls,
not sleeps or help strings. Tests that inject a failed output/read belong to the internal fixture
seam; agents use the CLI and visible recovery UI, never raw product HTTP.

## Agent behavior eval (separate private repository)

Three independent cases: an existing artifact operation should choose named query/write without
sessions or source rewrites; authoring a new action should verify the actual control in a session;
page-local/row-context work should use a session and preserve the intended state boundary. Grade
wire/tool traces AND final state. Report model, selected task IDs, first-attempt outcomes and any
credential/instrument failure separately from product failure. Do not claim a wording test is an
observed agent eval. The private eval files and results never enter this product repository.
