# Page operations

Page backend execution: function files and their calls (`functions.ts`, `function-source.ts`), schedules
(`schedule.ts`), the capabilities a run reaches (`backend.ts`, `sql.ts`, `query.ts`, `database.ts`) and a call's
admission (`admission.ts`). This card also covers `lib/page-doors` (the HTTP doors, the admission port and commit
guards) and `lib/function-schedules` (the scheduler and its claims), which have no card of their own.

## Rules
- The caller is the admitted principal (the door's reader, or a scheduled run's publisher), never anything in the
  call's input or resolver arguments.
- A function file's surface (callable names, `roles`, `schedule`) is read from its source text at publish
  (`staticSurface`), never from the evaluated module: a name with no role means anonymous. A new export form is
  either read statically there or refused at publish.
- Every capability re-decides the admission before it runs: page head (`pageHeadDigest`), the caller's role now,
  and a scheduled run's claim, through the `admit` port in `pageBackendCapability`. A new capability goes through
  that path; only fetch and db may reuse a passed decision, for `ADMISSION_MEMO_MS`.
- Writes: only a POST call or a scheduled run may write, never on an archived revision or from an opaque origin.
  A caps.sql write is one insert, update or delete through the page SQL door's guarded write, which re-decides
  the admission inside the commit (`admittedCommitGuard`). Never write a dataset from this module directly.
- A scheduled run acts as the head's content publisher, who must still own or edit the page. The scheduler's
  statements stand alone (no transaction of its own), and an effect checks `scheduleClaimHolds` inside its own
  commit, which locks the schedule row FOR SHARE last, after the page and its datasets.
- Secrets stay on the host. A connection's settings go to the runner's driver, never to resolver code; refusals
  carry a code and a name only; a failure's detail is redacted and shown to the page owner alone.
- Limits come from contracts (`RESOLVER_LIMITS`, `SQL_READ_LIMITS`); never restate a number here.
- The GraphQL code still here (`namespaces.ts`, `execution-policy.ts`, `document-check.ts`, legacy typeDefs files
  with `@auth`) is under the deprecated GraphQL layer's rule: fixes, not features.

## Checks
- `npm test -- --files services/app/lib/page-operations/__tests__/schedule.test.ts services/app/lib/page-operations/__tests__/sql.test.ts services/app/lib/page-operations/__tests__/backend.test.ts services/app/__tests__/page-functions.test.ts services/app/__tests__/function-schedules.test.ts services/app/__tests__/page-sql-door.test.ts`

## More
- [Page functions](../../../../docs/page-functions.md)
