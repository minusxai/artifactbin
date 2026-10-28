---
name: markup-notifications
description: Mutation-triggered queries, joined recipients, combined messages and recovery.
---
# Notifications after mutations

A standalone `<Notify name="status_notice" on="change_status">` in Helmet owns
one read-only SELECT returning exactly `to` and `message`. Give each rule a unique
name; several rules can name the same persistent mutation. Each successful run
schedules one durable job for all its rules, even when the mutation affects
zero rows. Failed mutations schedule nothing; Notify adds no affected-row guard.

```jsx
<Notify name="status_notice" on="change_status">{`
  select assignee as "to", 'Task ' || title || ' is now ' || status as message
  from tasks.rows where id = $task_id
`}</Notify>
```

This example imports a stored tasks dataset with id, title, status and a user-typed
assignee. The platform displays the triggering actor separately from the message.
`to` accepts an account ID, a typed list of account IDs, or null; `message` is plain
text. Null and ineligible recipients are skipped. JSON strings are not lists.

There is one notification per user per mutation run, across all linked rules.
Repeated users and identical messages are collapsed; distinct messages are
combined in that single item. Nothing is published until all rules succeed.
SQL WHERE and GROUP BY can still select recipients and compose bulk summaries.

## Dataset sources and bindings

Notify uses the existing dataset query interface, supporting every current
source. Like Query, it can read Imports and named upstream queries, or use
`source="ref:DATASET_ID"` to run SQL in that dataset. SQL follows its database;
there is no requirement to use identical SQL across stored data and Postgres.
For an exposed Postgres table with watcher IDs and task titles, for example:

```jsx
<Notify name="watcher_notice" on="change_status" source="ref:pgs123">{`
  select watcher_ids as "to", format('Task %s changed', title) as message
  from public.task_watchers where task_id = $task_id
`}</Notify>
```

Replace pgs123 with the connected dataset ID. Connection setup, exposed tables
and secrets use the normal [catalog workflow](databases.md). Reading a connected
dataset here does not enable mutations that its data source does not support.
The query receives saved scalar arguments and supported platform identity/time
values. It reads current authorized data after commit and may see later changes;
there are no before/after snapshots. Do not depend on unsaved browser state or
introduce new required inputs. A deleted row can yield no notification.

## Membership and recovery

Recipients must have explicitly joined the artifact and still be allowed to read
it and every dataset used by the query, including filter-only and upstream
sources. Visibility, link access and read permission alone do not qualify.
Notifications never join or invite users. Leaving or losing access makes a user
ineligible; membership and access are checked before creation and disclosure.

Processing is asynchronous. The mutation response's `mutationRunId` identifies
its job in the notification status UI. A notification failure does not undo the
mutation: retry the job there; never rerun the successful mutation to repair
delivery. Retry keeps the saved rules and arguments and may read newer data.
Request replay recovers the same run and item identity; an intentional new action
gets a new run. An authorized initiator or artifact manager can inspect and retry
its job; ordinary readers cannot inspect another person's run.
