# Page data doors

SQL reads and writes are the supported page data contract. The caller is the request reader, never a request variable;
the one exception is a page's declared query on the default connection that an Admin of the page's group approved
(`approved-queries.ts`, lib/query-approvals), which runs as that group at member level, chosen by the server alone, for
a signed-in ordinary account that can open the page; only such an account is told the owner's name when refused.
A write commits only under `pageCommitGuard`, decided inside the commit from locked rows; a read leaves only after
`pageVerifier`. Never run author code on the server. Preserve Hasura-style dataset permissions and lock ordering.

Checks: `npm test -- --files services/app/__tests__/page-sql-door.test.ts services/app/__tests__/page-sql-door-locks.test.ts`.
