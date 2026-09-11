# Dataset data policies

## Boundaries and contract

Sharing is the only audience control. Everyone who can view a dataset—including
commenters, editors, owners and anonymous readers of public/unlisted data—uses
one data policy. There is no separate grant, audience selection or group system.
Editors and owners manage sharing and policies. Editing a
backing dataset's definition is distinct from executing its declared data actions.

The Hasura permission entries use one role, `viewer`, for every dataset reader.
An allowed INSERT/UPDATE/DELETE entry grants that action; columns, filter, check,
set presets and function restrictions constrain it. Missing operations deny.
Read-only datasets remain unwritable. Datasets without a policy retain legacy
editor-only writes. Raw SQL submission still requires edit access. Removing a
policy restores those defaults, and editors and owners can do so.

The pure shared parser owns supported Hasura syntax. The app owns reader
admission and policy administration. One server-owned reader predicate runs both
at admission and inside the atomic dataset CAS, along with policy revision and
document revision checks. Removing a private dataset share or changing visibility
while execution is in flight prevents persistence. Every provider dispatch also
rechecks authorization; a call already dispatched cannot be unspent.

SQL uses DuckDB's bound DML plan and native SELECT AST, typed staged candidates,
server presets and pre/post row predicates. All rows pass before any write is
applied. SQL NULL semantics come from DuckDB. Supported forms are INSERT
VALUES/SELECT (including source CTEs), ordinary UPDATE SET/WHERE and DELETE WHERE.
RETURNING, upserts, CTE-prefixed writes, UPDATE FROM and opaque table functions
are explicitly rejected in policy mode. Function checks inspect resolved bound
dependencies and syntactic calls that DuckDB lowers or expands.

Read confidentiality, relationship predicates, connected PostgreSQL writes and
full Hasura metadata APIs remain outside this change. Policies govern writes;
they do not filter reads. Connected PostgreSQL datasets remain read-only.

## Validation evidence

Tests cover identical action constraints for all readers; private dataset admission;
share revocation during mutation commit; and editor policy create/update/removal,
revision conflicts and audit attribution. Editor admission tests failed with 404
before the authorization change. Sharing tests cover editors granting all three
roles, changing link access and removing shares, including their own. Viewers and
commenters cannot administer rules or sharing. Owner identity survives share
replacement; deletion and restoration remain owner-only. Policy edit access is
rechecked in its final compare-and-swap. The sharing transaction locks the artifact
before checking permission and returns success even when an editor removes themself.
The visual editor exposes operation, column, condition and function controls.

Generation uses deterministic fixtures, separate operator connection/call/token
allowances and editor-approved execution capabilities. Failed dispatched calls
remain charged; the invocation cache avoids duplicate calls on CAS retries.
No paid provider is used for these checks.

Runnable checks: npm run validate; npm test; npm run build;
npm run test:gates -- --only=dataset-policies,generation-mutations,mutation-permissions,managed-iframe --servers=1.

## Editor experience contracts

- `/a/:id/edit` and the corresponding pretty artifact address resolve the same
  artifact and permission checks, then select its editor by format. The obsolete
  `/datasets/:id/edit` route is removed, without redirects.
- Existing dataset editing uses artifact chrome. An admitted editor can open
  sharing from Artifact controls and from the editor header.
- The policy condition editor owns recursive Hasura predicates behind a controlled
  `value/onChange` boundary. Each comparison and logical group can be edited or
  removed independently; unrelated predicates, presets and permission metadata
  survive GUI/source round trips. Empty All and Any retain their DSL semantics.
- The dataset workspace presents data actions, a data preview, and source settings
  as separate sections with clear save scope. Advanced source remains available.
  Title-only saves use metadata PATCH with the observed state, leaving protected
  rows untouched; successful saves refresh the retained artifact before returning.
- Verify behavior first with failing condition/route/chrome tests, then full tests,
  production browser gates, and desktop/mobile inspection of the running app.
