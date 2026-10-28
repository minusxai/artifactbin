# Mutation notifications: scope and behavior

After a named mutation succeeds, run a query and use its results to notify users.

Published proposal: https://app.artifactbin.dev/a/61YVj6
Implementation: https://github.com/minusxai/artifactbin/pull/188

## Dataset support

Notifications must support every dataset source artifactbin already supports. Notification logic is dataset-agnostic: it runs the authored query through the existing dataset query interface, then uses the returned `to` and `message` rows to notify users.

Queries use the SQL and features supported by their database. Source-specific execution stays in the existing query layer. There is no SQLite-only restriction and no requirement for identical SQL across databases.

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

Return a user ID, a typed list of user IDs, or null in `to`, and plain text in `message`. Multiple result rows can notify multiple users. Skip null recipients and deduplicate users within each result row. Do not treat JSON strings as recipient lists.

The query receives saved scalar mutation arguments and supported server identity/time values. It reads current data after the mutation, including any later changes. It does not receive before/after row snapshots. A deleted row may produce no notification.

## Multiple rows, retries and failures

Every successful mutation run with linked notification rules schedules one job containing all those rules, including a mutation that affects zero rows. All rules must finish successfully before any notifications are published. Failed or rolled-back mutations schedule nothing. Notification rules do not add an affected-row guard.

Generate at most one notification per user per mutation run, across all notification rules linked to that mutation. A query may return zero, one or many rows; group all matching messages for a recipient into that single notification and collapse identical messages. Use mutationRunId plus recipient user ID as the notification identity. Request retries cannot create another notification; a deliberate new mutation run may create a new one. SQL WHERE and GROUP BY can still select recipients and compose bulk summaries.

The data write, mutation receipt and notification job commit together. A request retry keeps the same run ID; an intentional new action gets a new ID. If the process crashes, a worker may run the read-only query again, but only one result is committed for that job.

Once the mutation succeeds, a notification failure does not undo it. Authorized users can inspect its status and retry the notification job without repeating the mutation. The retry uses the saved rule and arguments, and may read newer data.

Current limits: 1,000 query-result rows, 2,000 recipients, 500 Unicode code points per message, 1 MiB of intermediate/final result data, and 5 seconds of query execution. Source loading uses the existing dataset query layer; this change does not add a separate notification-specific loader or source-size cap. Exceeding a limit fails the notification job visibly; it does not send a truncated result.

## Recipients and access

The platform supplies the actor; authors cannot override it in the message. The worker rechecks the initiating user or token’s access. It does not borrow a background worker’s or owner’s identity.

Only users who have explicitly joined the artifact may receive its notifications. Public visibility, link access, or read permission alone does not qualify, and a notification must never automatically join or invite someone. Recipients must also currently be allowed to read the artifact and every dataset used by the query, including datasets used only in filters or upstream queries. Check membership and access before creating notifications and again before showing or delivering them. Users who leave the artifact are no longer eligible; skip them without failing the mutation.

Existing block and test-user isolation rules apply. Unknown, deleted or ineligible recipients are skipped; malformed recipient values fail the job. Only the authorized initiator or current artifact managers can inspect and retry a run’s jobs. Ordinary readers cannot inspect someone else’s run.

## Agent instructions

For existing artifacts, agents should use named afbin query reads and named writes. Use sessions to test newly authored UI, browser-local state and row/cell actions that the headless CLI cannot invoke.

The commands are afbin query ID --name tasks and afbin query ID --write --name change_status --param task_id=... --param status=.... These authenticated named operations already use POST. This change does not add a GET alias.

UI write testing must use an isolated copy with copied writable datasets. A local draft can still reference the original datasets. Publish the isolated data and update Imports before testing; never fall back to writing the original.

## Verification

Required checks cover stored and PostgreSQL query sources (including models), saved arguments and actor identity, combined messages across rules, explicit membership, source access and credential revocation, bulk and zero-row mutations, concurrent retries, lost responses, and retrying notification processing without repeating a mutation. Real PostgreSQL integration runs through the existing CI gate.

Agent evals verify headless operation of existing artifacts, session testing of newly authored UI, and session fallback for browser-local state. Test copies must isolate writable datasets; the grader checks that original dataset versions are unchanged.

Current implementation and check results: https://github.com/minusxai/artifactbin/pull/188. Focused checks, deferred suites and live eval outcomes are reported separately; a deferred suite is not a pass.

## Limitations

Not included: an authenticated GET alias, a headless row/cell API, scheduled notifications independent of mutations, rich HTML messages, or production email delivery. Browser retry IDs survive retries on the same page; recovery after a full page reload is not implemented.

A successful mutation must reliably schedule its notification query so a crash cannot lose the trigger. Dataset-specific execution belongs in the existing data layer, not in notification logic. Existing dataset write capabilities are unchanged; notification queries support the sources already supported by the query layer.
