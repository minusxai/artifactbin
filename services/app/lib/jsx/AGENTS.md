# Static JSX

Read [the story UI instructions](../story-ui/AGENTS.md) before changing this parser, validator or
serializer. They cover both sides of the static-markup boundary and the round-trip guarantees.

This module is a leaf. Besides the parser, validator and serializer it owns the vocabulary validation
checks against: `component-names.ts`, `story-components.ts`, `mermaid-source.ts`, `deck-spec.ts` with
its static `boundary-ids.ts`, and the `$_row` grammar in `row-scope.ts`. It imports only itself,
`@artifactbin/contracts` and `@artifactbin/utils`; `index.ts` stays browser-safe, so a node-only file
never enters it.
