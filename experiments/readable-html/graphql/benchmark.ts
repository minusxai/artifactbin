import { performance } from "node:perf_hooks";
import { createStore } from "./store.ts";
const rows = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  title: `Task ${i}`,
  done: false,
}));
const store = createStore({
  sdl: "type Query{count:Int!} type Mutation{add:Int!}",
  initial: { count: 0, rows },
  version: 1,
  queries: { count: (s) => s.count },
  mutations: { add: (s) => ++s.count },
});
const results: Record<string, number> = {};
for (const [name, run] of [
  ["query", () => store.query("{count}")],
  ["mutation", () => store.mutate("mutation{add}")],
] as const) {
  for (let i = 0; i < 20; i++) run();
  const start = performance.now();
  for (let i = 0; i < 1000; i++) run();
  results[name + "MillisecondsPerOperation"] =
    (performance.now() - start) / 1000;
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      records: rows.length,
      jsonBytes: Buffer.byteLength(JSON.stringify(store.snapshot())),
      ...results,
    },
    null,
    2,
  ),
);
