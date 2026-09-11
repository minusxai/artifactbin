# Dataset data policies

## Boundaries and contract

Sharing is the only audience control. Everyone who can view a dataset—including
commenters, editors, owners and anonymous readers of public/unlisted data—uses
one data policy. There is no separate grant, audience selection or group system.
Owners manage sharing and policies; editors can inspect policies. Editing a
backing dataset's definition is distinct from executing its declared data actions.

The Hasura permission entries use one role, `viewer`, for every dataset reader.
An allowed INSERT/UPDATE/DELETE entry grants that action; columns, filter, check,
set presets and function restrictions constrain it. Missing operations deny.
Read-only datasets remain unwritable. Datasets without a policy retain legacy
editor-only writes. Raw SQL submission still requires edit access. Removing a
policy restores those defaults, and only an owner can do so.

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

The revised API tests first failed without a separate grant and with different
editor/visitor policies. They now cover identical policy behavior for viewer,
commenter and editor shares; owner constraints; private dataset admission;
share revocation at the final CAS; policy removal; atomic checks; and owner-only
administration. The editor inspection test first returned 404, then passed with
read-only policy access. UI tests assert there are no audience/grant/enforcement
controls, and that editors have no policy save controls.

Generation uses deterministic fixtures, separate operator connection/call/token
allowances and owner-approved execution capabilities. Failed dispatched calls
remain charged; the invocation cache avoids duplicate calls on CAS retries.
No paid provider is used for these checks.

Runnable checks: npm run validate; npm test; npm run build;
npm run test:gates -- --only=dataset-policies,generation-mutations,mutation-permissions,managed-iframe --servers=1.
