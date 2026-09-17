// Vite's `?worker` import: the bundler emits the module as a separate
// same-origin chunk and hands back a constructor for it. Declared here rather
// than by pulling all of `vite/client` into the shared tsconfig — the app uses
// only this suffix and `*.css?inline` (web/vite-css.d.ts), and the root config is shared with the node
// services (same reasoning as orchestrator/prompts/story-guidance-yaml.d.ts:
// supply the TYPE the bundler's transform provides, and nothing else).
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

// Vite replaces this build-time flag; server-side imports have no env object.
interface ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}
