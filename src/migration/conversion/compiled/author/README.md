# Offline author adapter

`prepareAuthorBundle` invokes the archived text compiler and returns virtual JavaScript modules. It never imports or executes the authored module on the server. Mounting happens only in the browser, in ordinary caller-supplied HTML elements. No JSX parser, editor, legacy transport, or ambient binding global enters the output.

Combined kit builds must resolve the returned entry, `authored-module`, and `author-closure` together and resolve **every** Solid import, including kit imports, to the returned `solidRoot` browser files (version 1.9.15). `compileAuthorScript` is the standalone author-only bundle used by the focused proof; embedding it beside a separately bundled kit would create a second Solid runtime.

The entry exports asynchronous `mount(ports, mounts)`, returning a disposer. A module instance mounts once. Each mount supplies an element, unique stable identity, exported component name and optional props. `authorApolloPorts` maps declared scalar keys into `compiledPage` and named signal keys into `authorSignals`, using the actual core client. Its gql query must select both fields. The caller supplies query snapshots and subscriptions. Queries expose callable rows, loading, error and a fresh ready promise; disposal rejects pending promises and stops subscriptions.

Named signals persist JSON under their mount identity plus signal name. JSON uses the existing Apollo storable checks and the 256 KiB state limit per named value. Declared page signals remain scalar. Ordinary unnamed Solid signals retain their normal semantics.

Admission deliberately refuses network globals, mutations, uploads, dynamic imports and external packages. This is a bounded conversion adapter, not a JavaScript security sandbox or a claim that every archived script is supported. Pages still need the product's isolated runner origin. Private corpus source and proof artifacts stay outside the repository.

Run the focused browser proof with `PAGEGI_ARCHIVED_COMPILER_ROOT` pointing to the pinned offline archive, after building `dist/core.js`. No production service or database is used.
