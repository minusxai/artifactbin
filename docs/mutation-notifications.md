# Mutation notifications: scope and behavior

After a named mutation succeeds, run a query and use its results to notify users.

Published proposal: https://app.artifactbin.dev/a/61YVj6
Implementation: https://github.com/minusxai/artifactbin/pull/168

## Current support

This feature is implemented on the feature branch, not merged or deployed. It supports authenticated mutations to datasets stored in artifactbin. Notification queries run SQLite SQL over those stored datasets and supported named queries derived from them. They can join stored datasets and group results.

Connected Postgres and other external database sources are not supported by this notification implementation. Neither are browser-only table Values, folder imports, membership-table queries, or row/cell context that is not saved with the mutation. Unsupported declarations are rejected at publish time.

When external database support is added, queries can use that database’s SQL and features. No common SQL dialect or automatic translation is required. That work is outside this change. The database used to store artifactbin’s own application records is a separate concern; using Postgres there does not enable notifications over a connected Postgres dataset.

## Authoring

Place Notify beside Mutation in Helmet. Give it a unique name and use on to name the mutation. Its child is one read-only SELECT returning exactly two columns: to and message. Several notification rules can refer to the same mutation.

The example below assumes a stored tasks dataset containing id, title, status and an assignee user ID. Replace TASK_DATASET_ID with its real artifact ID. The notification displays the triggering actor separately, followed by text such as “Task Review pricing is now Done.”

```jsx
<Helmet>
  <Import name="tasks" src="ref:TASK_DATASET_ID" />
  <Value name="task_id" type="string" />
  <Value name="status" type="string" />
  <Mutation name="change_status">
    {`UPDATE tasks.rows SET status = $status WHERE id = $task_id`}
  </Mutation>
  {/* The actor appears separately from this message. */}
  <Notify name="status_notification" on="change_status">
    {`SELECT assignee AS "to",
             'Task ' || title || ' is now ' || status AS message
      FROM tasks.rows WHERE id = $task_id`}
  </Notify>
</Helmet>
```

For the current SQLite implementation, return one user ID per result row. Return multiple rows to notify multiple users. A null recipient is skipped. Messages are plain text. Do not encode recipient arrays as JSON strings; typed-list support in shared result handling is not a promise that current author SQL can produce lists.

The query receives saved scalar mutation arguments and supported server identity/time values. It reads current data after the mutation, including any later changes. It does not receive before/after row snapshots. A deleted row may produce no notification.

## Multiple rows, retries and failures

Every successful mutation run schedules one job for each linked rule, including a mutation that affects zero rows. Failed or rolled-back mutations schedule nothing. Notification rules do not add an affected-row guard.

A notification query can return zero, one or many rows. Use WHERE to choose recipients and GROUP BY to create bulk summaries. Different output rows remain separate notifications, even if their text matches.

The data write, mutation receipt and notification jobs commit together. A request retry keeps the same run ID; an intentional new action gets a new ID. If the process crashes, a worker may run the read-only query again, but only one result is committed for that job.

Once the mutation succeeds, a notification failure does not undo it. Authorized users can inspect its status and retry the notification job without repeating the mutation. The retry uses the saved rule and arguments, and may read newer data.

Current limits: 1,000 query-result rows, 2,000 recipients, 500 Unicode code points per message, 1 MiB of intermediate/final result data, and 5 seconds of query execution. Source loading has separate limits of 16 MiB, 100,000 rows and 5 seconds. Exceeding a limit fails the notification job visibly; it does not send a truncated result.

## Recipients and access

The platform supplies the actor; authors cannot override it in the message. The worker rechecks the initiating user or token’s access. It does not borrow a background worker’s or owner’s identity.

A recipient must currently be allowed to read the artifact and every dataset used by the notification query, including datasets used only in filters or upstream queries. Inbox and internal delivery also recheck access. Revoking source access hides dependent notifications.

Existing block and test-user isolation rules apply. Unknown, deleted or ineligible recipients are skipped; malformed recipient values fail the job. Only the authorized initiator or current artifact managers can inspect and retry a run’s jobs. Ordinary readers cannot inspect someone else’s run.

## Agent instructions

For existing artifacts, agents should use named afbin query reads and named writes. Use sessions to test newly authored UI, browser-local state and row/cell actions that the headless CLI cannot invoke.

The commands are afbin query ID --name tasks and afbin query ID --write --name change_status --param task_id=... --param status=.... These authenticated named operations already use POST. This change does not add a GET alias.

UI write testing must use an isolated copy with copied writable datasets. A local draft can still reference the original datasets. Publish the isolated data and update Imports before testing; never fall back to writing the original.

## Implementation and verification

Six workers completed separate areas: query execution/worker, compiler, job storage, run identity/replay, inbox/status UI, and teaching/demo/evals. Their changes are integrated in draft PR 168. The detailed worker briefs remain in the repository; they are not outstanding work assignments.

Live browser and CLI checks exercised bulk notifications, zero-row success, uncertain-response replay, access denial and retrying a failed notification without another mutation. The final teaching fixes passed 185 focused tests. Local validation passed; the routine affected-test command deferred to CI rather than reporting a pass.

Three fresh session-agent smokes passed saved-state checks. The external Fireworks eval passed two of three scenarios. Authoring failed because the agent wrote and restored the original test dataset. Instructions and grading were corrected, but that failed run was not rerun or counted as passing.

CI is not fully green: the latest inspected run has node-test failures and other checks still running. This proposal does not claim merge readiness. The current check results are on PR 168.

## Demo and remaining limitations

The local demo is http://localhost:5001/a/UKT0Hn. Sign in as mxmx_test_notify_actor@example.com at /login. From the foundation checkout, run npm run dev:otp -- mxmx_test_notify_actor@example.com for the local login code. Use a separate browser for mxmx_test_notify_recipient@example.com and /notifications. These links require the task’s development server to be running.

Not included: connected-database writes or notification queries, an authenticated GET alias, a headless row/cell API, scheduled notifications independent of mutations, rich HTML messages, or production email delivery. Browser retry IDs survive retries on the same page; recovery after a full page reload is not implemented.

Future connected-database work must reliably record the notification trigger with a successful write so a crash cannot lose it. Its query syntax can differ by database. That is the future requirement—not an additional abstraction to build in this change.
