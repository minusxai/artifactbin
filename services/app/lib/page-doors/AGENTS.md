# Page data doors

SQL reads and writes are the supported page data contract. The caller is the request reader, never a request variable.
A write commits only under `pageCommitGuard`, decided inside the commit from locked rows; a read leaves only after
`pageVerifier`. Never run author code on the server. Preserve Hasura-style dataset permissions and lock ordering.

Checks: `npm test -- --files services/app/__tests__/page-sql-door.test.ts services/app/__tests__/page-sql-door-locks.test.ts`.
