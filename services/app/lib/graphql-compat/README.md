DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend.

# GraphQL compatibility layer

New pages read and write their datasets with `` sql`…` `` (`POST /api/artifacts/<page>/sql`,
`lib/page-doors` `pageSqlDoor` over `lib/dataset-access` `executePageSql`) and call backend functions with
`fetch('/fn/<name>')` (`lib/page-doors` `pageFunction`). GraphQL stays only so pages published before
that keep working, unchanged. This layer is fenced: it is not removed, and it does not grow.

## What is here

- `dataset/`: each dataset's generated Hasura-style API: the schema (`hasura-schema`), the read and
  mutation compilers (`hasura-read`, `hasura-write`), `_can` (`can`), the direct and linked executors
  (`hasura`: `executeDatasetGraphql`, `executeLinkedDatasetGraphql`, `loadPageDatasets`, the publish
  checks `pageDatasetRoots` and `pageDatasetCheckSources`) and the skill's local preview of them
  (`local-hasura`, `local-preview`, which `lib/skills/preview-assets.server.ts` bundles by path).
- `page.ts`: the page GraphQL door (`/api/artifacts/<page>/graphql`, `pageGraphql`, its opaque-origin
  read) and a resolver's `caps.query` composition (`resolverDatasets`).
- In the page runtime, `lib/html-runtime/apollo/graphql-compat.ts` is the browser part: `client` and the
  `gql` parser of `@afbin/apollo`. `lib/html-runtime/browser-client.ts` assembles `@afbin/apollo` and is
  the only file that imports it.

Everything below it is not GraphQL and lives outside: the per-request dataset load, link authority,
the retained read port, cells, permissions and the SQL door (`lib/dataset-access`); request admission,
the after-read page verifier and the write's commit guard (`lib/page-doors`); the local state store
(`html-runtime/apollo/local-store.ts`). This layer imports them; they never import it.

Still outside the fence: page schema composition and execution (`lib/page-operations` `namespaces`,
`service`), backend `typeDefs` and `@auth` handling (`execution-policy`, `functions` for legacy files
on `/fn`) and the publish document check (`document-check`). `lib/page-operations` keeps them because
`/fn` and backend compilation call them in-module; moving them is the next step of this fence.

## The rule

`npm run validate` (`scripts/ci/module-graph.mjs`, rule 5, `GRAPHQL_COMPAT`) fails when:

- any file outside the layer imports it, unless it is listed in `GRAPHQL_COMPAT.importers`: the GraphQL
  routes (`app/api/artifacts/[id]/graphql`, its operation in `lib/operations/registry.ts`, the local
  connection's route), the browser client entry (`html-runtime/browser-client.ts`), and the composition
  points that still wire GraphQL in (publishing's document checks, a resolver's `caps.query` in
  `server.ts` and `app/api/runner/operations`). Tests may import it;
- a listed importer no longer imports it (the list only shrinks);
- a file of the layer does not open with the DEPRECATED header line above.

Do not add an importer to make new code work: read with `sql` and call functions with `/fn`. When a
listed importer stops needing GraphQL, delete its entry in the same change.
