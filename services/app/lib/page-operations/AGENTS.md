# Page operations

The page GraphQL engine (`namespaces.ts`, `service.ts`, `execution-policy.ts`): a page's schema composed from its
dataset links' generated APIs plus the built-in `viewer` and `_sql`, and its execution. This card also covers
`lib/page-doors` (the page SQL door, the after-read page verifier and the write's commit guard), which has no card
of its own.

## Rules
- No author code runs on the server: a page reads and writes only datasets, through `sql` (the page SQL door) or
  the deprecated GraphQL. A page schema composes dataset links only (`composePageSchema` refuses anything else);
  never add a door, link kind or capability that runs code a page or its author supplies
  (`services/app/__tests__/author-code-stays-off-the-server.test.ts` refuses one).
- The caller is the request's reader (lib/page-doors), never anything in the request's variables.
- A page write commits only under `pageCommitGuard`, decided inside the commit from locked rows; a read leaves only
  after `pageVerifier`. Never write a dataset from this module directly.
- The GraphQL here is under the deprecated GraphQL layer's rule (lib/graphql-compat card): fixes, not features.

## Checks
- `npm test -- --files services/app/lib/page-operations/__tests__/namespaces.test.ts services/app/__tests__/page-sql-door.test.ts services/app/__tests__/page-sql-door-locks.test.ts services/app/__tests__/author-code-stays-off-the-server.test.ts`
