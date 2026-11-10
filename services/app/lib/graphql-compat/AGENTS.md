# GraphQL compatibility (deprecated)

The fenced GraphQL layer that keeps pages published before SQL working: each dataset's generated Hasura-style API
(`dataset/`), the page GraphQL door and a resolver's caps.query (`page.ts`). Its browser half is
`lib/html-runtime/apollo/graphql-compat.ts`. It is not removed and does not grow: new pages read and write with
sql and call functions with `fetch('/fn/<name>')`.

## Rules
- No features: no new GraphQL capability, root, door, client API or importer. Security and correctness fixes are
  allowed, and required when the rest of the product is fixed for the same flaw. A fix keeps the behaviour pages
  depend on and changes only what made it unsafe.
- A fix reuses the guard the non-GraphQL path uses, never a second one: a page function call's caps.query write
  commits under `admittedCommitGuard`, as its SQL write does; a legacy resolver call carries no admission and
  keeps `pageCommitGuard`.
- Never add an entry to `GRAPHQL_COMPAT` in `scripts/ci/module-graph.mjs` to make new code work. When a listed
  importer stops needing GraphQL, delete its entry in the same change (a stale entry fails `npm run validate`).
- Every file here, tests included, opens with the DEPRECATED header line that `GRAPHQL_COMPAT` holds, copied exactly.
- Dependencies point one way: this layer imports lib/dataset-access and lib/page-doors (dataset loads, link
  authority, admission, commit guards); they never import it. Put anything that is not GraphQL there.

## Checks
- `npm run validate` (the fence)
- `npm test -- --files services/app/lib/graphql-compat/__tests__/hasura-read.test.ts services/app/lib/graphql-compat/__tests__/hasura-write.test.ts services/app/lib/graphql-compat/__tests__/hasura-schema.test.ts services/app/lib/graphql-compat/__tests__/raced-read.test.ts services/app/__tests__/page-graphql.test.ts services/app/__tests__/dataset-graphql-mutations.test.ts scripts/__tests__/module-graph.test.mjs`
