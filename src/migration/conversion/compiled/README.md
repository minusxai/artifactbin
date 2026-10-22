# Offline compiled conversion

These modules are explicit migration tools, never runtime fallbacks. `compileArchivedStatic` emits static HTML/CSS; `compileArchivedLocal` emits HTML/CSS plus a self-contained ordinary JavaScript bundle. Both run the archived compiler only in a bounded subprocess with isolated environment variables. The product server does not import them.

The local route currently admits scalar `Value` declarations in `Helmet`, exact archived static/layout kit modules, scalar `Button set={{field: value}}`, `Input`, `Textarea`, native bound input/select/textarea, and scalar text references. The single Apollo JSON field `compiledPage` owns all page scalar state. Hydration first claims the default SSR tree, then projects the saved state; this order is required to avoid stale initial text after reload. Each write merges through an Apollo update callback, preserving other fields.

Queries, imports, shared mutations, author scripts, arbitrary expressions, custom `Select`, SlideDeck and other undeclared kit behavior are blocked. A failed capability check returns no HTML. There is no implicit static fallback. The local result's functional classification applies only to its admitted local scalar subset and makes no dataset or shared-action claim.

The migration bundle resolves archived compiled kit and Solid modules from the archived build manifest, replaces `@mx/boot` entirely, and externalizes only `@afbin/apollo`. It has no network dependency on archived modules. Provenance records the archived build and actual contributing bundle modules. Source and output are bounded to 8 MiB and 32 MiB; subprocess execution is limited to 60 seconds. The source is parsed and capability-checked before invoking the archived compiler; author code is not evaluated.

The caller must choose this strategy explicitly. All corpus content and browser proof files belong outside the repository. A modified example proves adapter behavior only; it is not evidence that an unchanged corpus document has migrated.
