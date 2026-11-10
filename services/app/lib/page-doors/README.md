# Page doors

A page's plain-HTTP doors: the SQL door (`POST /api/artifacts/<page>/sql`), its functions
(`/api/artifacts/:id/fn/:name`), and what every page door shares: the request's reader, the after-read page verifier
(`pageVerifier`) and a write's commit guard (`pageCommitGuard`).

## A function call's admission (`resolverAdmit`, `admittedCommitGuard`)

A function call is admitted on a page head (lib/page-operations `admission.ts`). Before each capability it reaches,
`resolverAdmit` re-decides three things, using the caller's role on the page now and never the role recorded at
admission:

- the head is unchanged (`page_changed`);
- the caller still meets the function's `roles` or `@auth` (`caller_unavailable`);
- for a SCHEDULED run (an admission with a claim), two more conditions hold, because it acts with nobody asking. The
  caller must still be the head's content publisher, and must still hold owner or editor, whatever the function's
  `roles` allow (`publisher_unavailable`). Its claim must still be current (`claim_lost`), and is renewed.

A `caps.sql` write and a `caps.query` mutation decide the same rules again inside the commit transaction
(`admittedCommitGuard`), from rows locked in the global order (lib/artifact-access README "Lock order"). A write
therefore never lands after any of them has changed.

### The window for external effects

`caps.fetch` and `caps.db` reach systems outside this database, so nothing can fence an effect that has already been
dispatched. The checks happen before dispatch: before each fetch, at each `caps.db` open, and before each `caps.db`
query (the runner worker's `pageBackend.dbCheck`). A fetch or a query already sent completes, whatever changes while
it runs.

A passing decision for these capabilities is also reused for at most `ADMISSION_MEMO_MS` (1 s) per invocation
(lib/page-operations `backend.ts`), so a query loop costs one decision a second. A revocation, a republish or a lost
claim therefore stops further fetches and queries within 1 s. It stops a write at once: `caps.sql` and `caps.query`
decide on every call and again inside their commits.
