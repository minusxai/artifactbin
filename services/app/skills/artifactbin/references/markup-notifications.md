---
name: markup-notifications
description: Mutation-triggered notification queries, current-state messages and recovery.
---
# Notifications after mutations

A standalone `<Notify name="status_notice" on="change_status">` in Helmet owns
one read-only SQL query. Each successful run of the named persistent mutation
schedules it, even when the mutation affects zero rows. The query returns `to`
(account ID or null) and `message` (plain text). Use multiple rows for multiple
recipients; null and unavailable recipients are skipped. Typed recipient lists
are supported only by adapters that return actual lists, not JSON text.

```jsx
<Notify name="status_notice" on="change_status">{`
  select assignee as "to", 'Task ' || title || ' is now ' || status as message
  from tasks.rows where id = $task_id
`}</Notify>
```

The task dataset must declare `id`, `title`, `status` and a `user`-typed `assignee`.
The platform displays the triggering actor separately from the message. The query
reads current authorized data after commit, using that run's saved arguments;
it may see later changes. It cannot depend on unsaved browser state or introduce
new required inputs. `Notify` does not add an affected-row guard.

Notification processing is asynchronous. A mutation response's `mutationRunId`
identifies its jobs in the notification status UI. A failed notification does
not undo the mutation: retry the failed job there, never rerun the successful
mutation to repair delivery. A retry keeps the saved rule and arguments and may
read newer data. Request replay recovers the same run; an intentional new action
gets a new run. Current recipient access is checked before disclosure.
