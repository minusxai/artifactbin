# Page functions

A page's backend file is TypeScript that exports functions. A page calls one with a plain
`fetch('/fn/NAME')`; it may also run on a schedule. This page explains how a call is admitted, what it may reach,
and how scheduled runs work. The HTTP request and every answer code are in [HTTP API](http-api.md); the authoring
contract is the skill's [functions reference](../services/app/skills/artifactbin/references/functions.md); the
process that runs the code is the [runner](runner.md). The code is `services/app/lib/page-operations` (pure
admission, manifests and capabilities), `services/app/lib/page-doors` (the HTTP doors) and
`services/app/lib/function-schedules` (the scheduler); each file's header comment holds its own rules.

## A call from the page

The core runtime (`lib/html-runtime/fn-fetch.ts`) intercepts only a `/fn/` path on the page's own origin, after
URL resolution, so `/fn/../graphql` is not one; every other fetch reaches the browser untouched. The reader relays
the call over the frame bridge (`lib/html-runtime/fn-relay.ts` to `lib/html-reader/frame-bridge/parent.ts`), and
the parent makes it with the reader's own session as `GET|POST /api/artifacts/:id/fn/:name`, pinning the shell's
revision in `x-page-revision` and sending no other frame header. The parent drops a frame's own `revision`
parameter, and a read-only (archived) shell relays GET only. A call rejects only as fetch does: `AbortError` on its
signal, and `TypeError` with no page connection (an offline copy, or a frame that never attached within 3 s).

An unframed page (the owner host, an export capture) calls the route directly as nobody, reads only: its CSP
`connect-src` names the page's `/api/artifacts/:id/fn/` prefix, and the owner-host boundary
(`server/user-host.ts`) admits that path for the owner's served page only, as a guest forced to `Origin: null`.

## Who may call

The server derives the principal: `principal.tenant` from the page, `principal.subject` from the authenticated
account and `principal.role` from the caller's role on the page. Nothing in the input can grant identity or
authority. A remote runner calls back with that caller in its signed pin, and the app rebuilds the principal from
the pin. The page role is the same derivation datasets use, applied to the page's own sharing by `pageRole`:

- owner: the personal owner, or a group editor on a group page;
- editor: a named editor share, the link's editor role, or the host's document-editor grant, for an account;
- viewer: a named viewer or commenter share, or a group viewer;
- signed_in: any other account that can read the page;
- anonymous: no account (a visitor, a guest, a test user outside its sandbox).

A caller who cannot read the page has no role and is refused. `roles` (and a legacy file's `@auth`) mean "at
least" that role, in the order anonymous, signed_in, viewer, editor, owner. Dataset rules differ: they match
exactly one role per request.

## What a function may reach

`caps.fetch`, caps.sql, `caps.db` and, for older files, `caps.query`; nothing else. Size and time limits are
one table, `RESOLVER_LIMITS` in `services/contracts/src/runner.ts` (for example 8 MiB per runner message and
remote callback reply, `messageBytes`); caps.sql reads also take `SQL_READ_LIMITS`.

- **`caps.fetch`** fills `{{NAME}}` in the URL (percent-encoded), header values and body only for a declared
  secret whose bound host matches the request host. Anything else is refused before a value is read or a socket
  opens. Redirects are followed only for GET and HEAD requests that carry no secret. `set-cookie` is dropped, and
  every value used, with its URL-encoded and base64 forms, is redacted from the body, headers and URL. The run
  receipt records method, host, path as written, status, duration, bytes and secret names, never a query string,
  header value or body. `auth: {type: 'google', secret, scopes}` treats the secret as a Google service-account key
  (`lib/page-operations/google-auth.ts`).
- **caps.sql** is the page runtime's tag over the page head's linked datasets, as the caller
  (`lib/page-operations/sql.ts`). A single `insert`, `update` or `delete` in a call that may write (POST, or a
  scheduled run) is the page SQL door's guarded write; in a GET call it is refused with `read_only`.
- **`caps.db`** opens a session on a connection the pinned version declares with a database kind and the owner
  configured (`lib/page-operations/database.ts`); the runner owns the driver and the tunnel
  ([runner](runner.md#database-connections-capsdb)). Function code never sees the password but can run any SQL
  that user may, so owners use a read-only database user.
- **`caps.query`** runs GraphQL over the same datasets as the caller, through the deprecated compatibility layer.

An execution failure after admission has an unknown outcome; the host never retries it. Archived revisions permit
reads only.

**Secrets.** The declared names and hosts are immutable version metadata; values are held separately, encrypted
and scoped to the backend file and its owner. Missing or revoked values fail closed. Owners set them with the
session or bearer API at `/api/my/resolvers/{backendId}/{version}/secrets` (`PUT {name,value}`, `DELETE {name}`,
`GET` answering configured names only). Page editors cannot configure another owner's credentials. Setting a value
never changes HTML, backend source, version metadata or downloads, and rotation and revocation apply to published
versions at once.

## Every capability re-decides the call

A call, a reader's or a scheduled run's, carries its admission in the trusted run input: the page, a digest of
the head it was admitted on, the function and a scheduled run's claim (`lib/page-operations/admission.ts`). Before
each capability dispatch, `resolverAdmit` (lib/page-doors) refuses the call if:

- the page head changed: published again or removed (`page_changed`);
- the caller's role now no longer satisfies the function's `roles` or `@auth` (`caller_unavailable`);
- for a scheduled run, the caller is no longer the head's content publisher or no longer holds owner or editor,
  whatever `roles` would admit (`publisher_unavailable`);
- a scheduled run's claim is no longer current (`claim_lost`); otherwise the lease is renewed.

A caps.sql write and a `caps.query` mutation decide all of these again inside the commit transaction
(`admittedCommitGuard`). The commit locks the page and its datasets in the global order
(`services/app/lib/artifact-access/locks.ts`), reads the page row and the caller's role from facts locked as they
are read, and locks the schedule row last. A revocation, a republish or a reclaim either committed first and
refuses the write, or waits for it. A legacy GraphQL resolver call carries no admission; its writes keep
`pageCommitGuard`.

**The window for external effects.** `caps.fetch` and `caps.db` reach systems outside this database, so nothing
can fence an effect already dispatched. Their checks run before dispatch: before each fetch, at each `caps.db`
open and before each `caps.db` query (the runner worker's check). A fetch or query already sent completes,
whatever changes while it runs. A passing decision for these capabilities is reused for at most
`ADMISSION_MEMO_MS` (1 s) per invocation, so a revocation, republish or lost claim stops further fetches and
queries within a second. It stops a write at once, because caps.sql and `caps.query` decide on every call and
again inside their commits.

## Scheduled functions

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

`schedule` is read from the source at publish in the same static form as `roles`
(`lib/page-operations/function-source.ts`) and checked by `scheduleManifest`, whose header explains why it is an
interval and not cron. The minimum is `FUNCTION_SCHEDULE_MIN_MINUTES` (15); a development or test process may
lower it with `SCHEDULES__MIN_INTERVAL_MINUTES`, which any other process ignores. A schedule in a file with
`typeDefs` fails publish. The manifest is stored with the backend version (`html_backend_versions.function_schedules`)
and included in the version hash.

`startFunctionSchedules` ticks every 15 s (`lib/function-schedules/scheduler.ts`):

1. **Sync.** It derives `(page, backend link, function, interval)` from every live page head and upserts
   `page_function_schedules`. A new schedule is due at once; a changed interval counts from the last run; a row the
   heads no longer derive is deleted once no run holds it. So a republish without the schedule, a trash or a delete
   stops the runs, and a restore resumes them.
2. **Claim.** One statement leases due rows that no run holds, in database time, fenced by `claim_epoch`
   (`lib/function-schedules/claims.ts`). Rows are taken round-robin by publisher, so one publisher's many
   schedules never starve another's; a process runs at most 4 at once. An overlapping occurrence is skipped, not
   queued.
3. **Run.** The run is decided again at run time: the head must still schedule the function, and it runs as the
   head's publisher, `artifacts.content_publisher_user_id`, with the role that account holds now (owner, or editor
   through a named share). Only content creation, fork, publication and revert stamp that column; metadata,
   sharing, transfer, trash restore and live-region edits keep it, so an owner renaming a page never lends their
   authority to code an editor published. `actor_user_id` is never taken for the author. If the publisher no
   longer holds owner or editor, or no account published the head, the run records `publisher_unavailable` and
   runs nothing until someone who does publishes again. Otherwise the function runs through `callPageFunction`
   exactly as that account's own `POST /fn/<name>` would, with input `{}` and its `roles` checked.
4. **Record.** Only the current claim records. A success sets the next run one interval after it finished; a
   failure stores the code, the function's message and the owner-only detail, and backs off.

**Capacity.** One publisher may have at most `FUNCTION_SCHEDULE_LIMIT` (20) scheduled functions active across the
live heads whose content it published. This is an invariant of every transaction that activates schedules (create,
fork, publication, revert and trash restore), checked after the write and refused whole with `schedule_limit`
(`lib/artifacts/schedule-capacity.ts`).

**A CSV-linked dataset.** A page that links a CSV file (an `af-dataset` link to `items.csv`) publishes it as a dataset, and a schedule may then write
newer rows into it. Republishing with the CSV unchanged keeps the dataset as it is now: the publish reuses a
dataset mapping whose head has moved past the recorded revision (`lib/publish/publish/bundle.ts`). A changed CSV is a
conditional replace of the recorded revision, so once the dataset has newer rows it is refused with a version
conflict and nothing is overwritten.

**Visibility.** `functionSchedulesOf(page)` is the run state. Only the owner reads it, through
`GET /api/my/artifacts/:id/resolvers` (each resolver's `schedules`); the Resolvers panel shows each function's
interval, last outcome, next run and a failure's code, message and detail.
