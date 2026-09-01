// Vite's `?worker` import: the bundler emits the module as a separate
// same-origin chunk and hands back a constructor for it. Declared here rather
// than by pulling all of `vite/client` into the shared tsconfig — this is the
// one suffix the app uses, and the root config is shared with the node
// services (same reasoning as orchestrator/prompts/story-guidance-yaml.d.ts:
// supply the TYPE the bundler's transform provides, and nothing else).
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
