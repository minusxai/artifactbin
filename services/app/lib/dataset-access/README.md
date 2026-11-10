# Dataset access

The datasets a request reads and writes, below every door, and the page SQL door itself:

- `authority`: which dataset a page link resolves to, and whether the caller may read it through the page.
- `linked`, `table-model`: the per-request load of one dataset or a page's links for the caller (the read
  snapshot, the write decision, per table what the role may select, write and change), shared by the SQL
  door and the GraphQL compatibility layer so a role sees the same rows through either.
- `retained`, `write-reply`, `types`, `model`: the retained read port (role view and read fences), the
  written rows as the role shows them, row identity.
- `page-sql`, `page-sql-door`, `sql-read`: `` sql`…` `` over a page's links (reads and policy-checked
  writes) and a resolver's `caps.sql` tables.
- `cells`, `policy`: live cell writes and the dataset permissions door.
- `local-files`, `local-sql`, `local-types`: the skill's local preview data (browser- and archive-bundled
  leaves, `DEEP_MODULES` in `scripts/ci/module-graph.mjs`).

Nothing here imports `lib/graphql-compat` (the module-graph check refuses it). The table model keeps its
generated-API names (`root`, a column's `field`) because published pages' GraphQL schemas are generated
from them, and SQL refusals still travel as `graphql`'s `GraphQLError` with `extensions.code`, the carrier
the compatibility layer passes on; both are kept so no published page changes behaviour.
