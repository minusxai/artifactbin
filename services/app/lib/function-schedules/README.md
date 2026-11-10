# Scheduled page functions

A typeDefs-free backend schedules its own functions:

```ts
export const schedule = { refresh: 'every 1 hour' };
export const roles = { refresh: 'owner' };
export default {
  async refresh(input, principal, caps) {
    const items = await (await caps.fetch('https://api.example.com/items')).json();
    for (const item of items) await caps.sql`insert into items (title, price) values (${item.title}, ${item.price})`;
  },
};
```

Pages then read the data with `sql` as usual. `caps.sql` is the page runtime's tag (every `${…}` a bound
parameter). It writes only in a call that may write: a POST `/fn` call or a scheduled run. Such a write is the page
SQL door's guarded write (lib/page-doors `resolverSql`, lib/page-operations `sql.ts`). In a GET call a write is
refused with `read_only`. Nothing here uses the GraphQL compatibility layer.

## Declaring a schedule (lib/page-operations `schedule.ts`, `function-source.ts`)

`schedule` is read from the source text at publish, in the same static form as `roles`: a top-level `const` object
literal with identifier or string-literal keys and string-literal values. Every key must be a function the file
declares (a default-export key or a named exported function). Each value is an interval,
`every [N] minute(s)|hour(s)|day(s)` (`every 15 minutes`, `every hour`, `every 2 days`), at most a year.

**Why an interval and not cron.** A scheduled function pulls data on a period. An interval makes the rules a
schedule needs checkable from the text alone. The shortest interval is the field itself (cron's real gap is not:
`0,1 * * * *` runs a minute apart). No overlap is "the next run is an interval after the last one finished". Backoff
is a multiple of the interval. Wall-clock alignment ("at 09:00") is the one thing cron adds, and a data refresh does
not need it.

The minimum is `FUNCTION_SCHEDULE_MIN_MINUTES` (15). A development or test process may lower it with
`SCHEDULES__MIN_INTERVAL_MINUTES` (lib/platform config); any other process ignores that setting. Anything else
fails publish with `invalid_schedule: …`: a computed, spread, getter, method, shorthand, template or non-string value;
a computed, `__proto__` or repeated key; `let`/`var`; a destructured or re-exported `schedule`; a key that is not a
declared function; an interval outside the grammar or below the minimum; an empty schedule; or a schedule in a file
with `typeDefs`. The manifest `{name: intervalMs}` is stored with the backend version
(`html_backend_versions.function_schedules`), and the version hash includes it.

## Running (`scheduler.ts`)

`startFunctionSchedules` (lib/runtime background tasks) ticks every 15 s. One tick does four things.

1. **Sync.** It derives `(page, backend link, function, interval)` from every live page HEAD, meaning `artifacts`
   rows with `deleted_at IS NULL`, their `htmlLinks`, and the linked version's manifest. It upserts
   `page_function_schedules`. A new schedule is due at once. A changed interval counts from the last run. A row the
   heads no longer derive is deleted once no run holds it. So a republish without the schedule, a trash or a delete
   stops the runs, and a restore resumes them.
2. **Claim.** One statement leases due rows that no run holds. The lease is DATABASE time (`lease_until` from
   `now()`, never a process clock), named by `claim_token`, and moves `claim_epoch`, the fencing token (one more per
   claim). Rows are taken round-robin by publisher, each publisher's earliest first, so one publisher's many
   schedules never starve another's. A process runs at most 4 at once. The lease outlasts any run (the app's run
   wait plus 5 minutes) and is renewed before each capability the run reaches. A run that is still open is never
   started again; an overlapping occurrence is skipped, not queued. A crashed or suspended process's lease expires
   and another process may claim the row; from then on the old run's effects are fenced out (below).
3. **Run.** The run is decided again at run time. The head must still schedule the function, and it runs as the
   head's PUBLISHER: `artifacts.content_publisher_user_id`. Only content creation, fork, publication (a replace) and
   revert stamp that column, in the statement that writes the content. Metadata, sharing, transfer, trash restore
   and live-region edits keep it, so an owner renaming a page never lends the owner's authority to code an editor
   published. That account runs with the role it holds on the page now:
   - owner, for a personal owner or a group editor on a group page;
   - editor, through a named editor share.

   No other source names the publisher: `actor_user_id` is the last writer of anything, metadata included, so it
   is never taken for the author. Every scheduled function was published after `content_publisher_user_id`
   existed (schedules arrived with it), so an empty column fails closed with `publisher_unavailable` until a content
   publication stamps it.

   If it no longer holds owner or editor (it left the group, was unshared, or the page was transferred away from it),
   or no account published the head, the run records `publisher_unavailable` and runs nothing until someone who does
   publishes the page again. The function runs through lib/page-operations `callPageFunction` exactly as that
   account's own `POST /fn/<name>` would: input `{}`, principal `{tenant: page, subject: publisher, role}`, its
   `roles` checked against that role (an owner-only function refuses an editor's run, `forbidden`), the same
   invoker, runner, limits and secrets, and only the declaring file.
4. **Record.** Only the claim that is still current (token and epoch) records. A success sets the next run one
   interval after it finished and clears the failures. A failure stores the code, the function's own message and
   the owner-only detail (redacted of secrets, as an owner call answers). The n-th failure in a row waits
   `interval × 2^(n-1)`, up to 32 intervals and at most a day unless the interval is longer.

Every statement stands alone, so none is enqueued inside another transaction's callback (the PGLite rule). Due times
come from the scheduler's `now` port, which is how the tests drive the clock
(`services/app/__tests__/function-schedules.test.ts`); leases are the database's.

## Every capability re-decides the call (lib/page-operations `admission.ts`)

A run, scheduled or a reader's `POST /fn/<name>`, carries its ADMISSION in the trusted run input: the page, a digest
of the head it was admitted on (version, edit, links), the function, and a scheduled run's claim. A remote runner signs
it into its pin; resolver code never sees it. Before each capability dispatch the runner reaches (`caps.sql`,
`caps.query`, `caps.fetch` with its secrets, `caps.db` open, and the runner worker's own check before every `caps.db`
query), lib/page-doors `resolverAdmit` refuses the call if any of these changed:

- the page head (`page_changed`): published again, or removed, since admission;
- the caller's role on the page now (never the role recorded at admission) no longer satisfies the function's
  `roles` or `@auth` (`caller_unavailable`);
- for a scheduled run, the caller is no longer the head's content publisher or no longer holds owner or editor, even
  when the function's `roles` would admit anyone (`publisher_unavailable`);
- the scheduled run's claim is no longer current (`claim_lost`); otherwise the lease is renewed.

A `caps.sql` write, and a `caps.query` mutation (a security fix in lib/graphql-compat, whose README separates fixes
from features), decide all three again INSIDE the commit transaction (`admittedCommitGuard`). The commit locks
the page and its datasets in the global order (lib/artifact-access README "Lock order"), then reads the page row
FOR SHARE and the caller's role from facts locked as they are read, and locks the schedule row last, FOR SHARE. A
revocation, a republish or a reclaim either committed first and refuses the write, or waits for it. The owner losing
access to a dataset is the dataset write's own decision there. A legacy GraphQL resolver call carries no admission;
its writes keep `pageCommitGuard`.

Fetch and external databases have a window. Their checks run before dispatch (and a passing decision is reused
for at most `ADMISSION_MEMO_MS`, 1 s, per invocation), and an effect already dispatched to an outside system cannot be
fenced. lib/page-doors README "The window for external effects" describes it.

## Limits

One publisher may have at most `FUNCTION_SCHEDULE_LIMIT` (contracts, 20) scheduled functions active across the live
heads whose content it published. This is an invariant of the transactions that activate schedules, not a
pre-check (lib/artifacts `schedule-capacity.ts`). Each of these counts the publisher's active total after its write
and refuses it whole with `schedule_limit` (400) when over the limit:

- create and fork;
- publication, a retained-link publish included;
- revert;
- trash restore.

An unchanged republish writes nothing and stamps no publisher, so it activates nothing. The count is serialized per
publisher: the transaction locks the publisher's `users` row FOR UPDATE after its artifacts (lock order step 3), so
two writes that add to one publisher's total run one after the other.

## Refreshing a CSV-linked dataset

A page that links `./items.csv` publishes it as a dataset, and a schedule then writes newer rows into it. Editing
and republishing the page with the CSV unchanged keeps that dataset as it is now. lib/publish `bundle.ts` reuses a
dataset mapping whose head has moved past the recorded revision; an asset keeps its exact revision, since its URL
serves those bytes. A CHANGED CSV is a conditional replace of the revision the publish recorded, so once the dataset
has newer rows it is refused with a version conflict and nothing is overwritten (docs/http-api.md).

## Visibility

`functionSchedulesOf(page)` is the run state. Only the owner reads it, through `GET /api/my/artifacts/:id/resolvers`
(each resolver's `schedules`). The Resolvers panel shows each function's interval, last outcome, next run, and a
failure's code, message and detail.
