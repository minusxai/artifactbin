# Managed Iframe implementation

Approved direction: top-level artifact, trusted `i.` controls, opaque `srcdoc` author region inside a bootstrap-only protective wrapper. No per-artifact hostname, no sandbox relaxation, no Three.js exception.

## Ordered merge gates

1. Resolve startup observability/reliability with default browser security; retain repeated reload and navigation negative controls. OPEN. Investigator is comparing console-only vs parent-message observation.
2. State delivery: initial snapshot, changed-field deltas, named listener subscriptions, bounded coalescing of state only, disposal. IN PROGRESS; core projection tests verified red. Mutations remain ordered requests and are never coalesced.
3. Managed markup: static `<Iframe>` children compiled into isolated DOM and ordered scripts; parent never renders these children. IN PROGRESS; compiler core tests verified red. Server validation and read-time interpreter both enforce the boundary.
4. Cached assets: reuse guarded URL importer/cache for bundled JS and supported assets; public read-only asset origin, no viewer authority, no redirect/proxy endpoints on that origin. Dynamic GET adapter is convenience only; CSP enforces direct-network limits. OPEN.
5. Runtime integration: private port through wrapper, declared data operations, compiled content loading, resource disposal and visible failures. Existing Helmet scripts stay isolated; no parent DOM capability. OPEN.
6. Independent review: red replay, validate, full suite/build, actual publish/render/edit/mutate and navigation/startup/lifecycle/browser performance gates, PR CI. Update current PR with empty body. OPEN.

No phase completion implies production rollout verification. HTTPS/DNS asset-host provisioning and staging cookies/device checks require deployment environment; report them separately from implemented/CI-tested code.

## Public surface

`<Iframe title="Scene" height={400}>` contains static HTML/CSS and scripts. External scripts are self-contained browser bundles, declared with their original HTTP(S) CDN URL; import/cache resolution happens before execution. No recursive module graph bundler. Script blocks use static JSX string children. Internal scripts use `mx.params.get/set`, `mx.params.subscribe(names, callback)`, `mx.data.get/subscribe`, and declared `mx.mutate`; these do not grant account, arbitrary authenticated HTTP, or parent DOM access.

All getters remain synchronous from an initial snapshot plus deltas; named subscriptions filter callbacks, not getter freshness. Existing callback-only subscriptions remain compatible. The browser composites each child canvas directly; pixels do not cross the bridge.
