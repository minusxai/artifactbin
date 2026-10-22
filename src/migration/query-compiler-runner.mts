/** Offline subprocess only. Archived parser/compiler modules do not enter the server graph. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileProgramResolver } from "./programs/compiler.ts";
import { compileLegacyServerModule } from "./server-module.ts";
const root = path.resolve(process.argv[2] ?? "");
const archived = (relative: string) =>
  import(pathToFileURL(path.join(root, "services/app", relative)).href);
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > 9 * 1024 * 1024)
    throw Error("query_input_limit");
}
const input = JSON.parse(text);
const { parseJsx } = await archived("lib/jsx/index.ts");
const { validateHelmet } = await archived("lib/document/helmet.ts");
const parsed = parseJsx(input.source);
if (!parsed.ok || validateHelmet(parsed.nodes).length)
  throw Error("query_source_invalid");
const { storyBodyFor } = await archived("lib/document/body.ts");
const split = storyBodyFor(input.source);
if (!split) throw Error("query_source_invalid");
if (!split.content.serverScript) {
  process.stdout.write("null");
  process.exit(0);
}
const raw = {
  imports: split.content.imports,
  values: split.content.values,
  queries: split.content.queries,
  mutations: split.content.mutations,
};
const { prepareCompile, compileDataflow } = await archived(
  "lib/dataflow/compile-dataflow.ts",
);
const ctx = await prepareCompile(raw, async (ref: string) => {
  const selected = input.bindings.filter(
    (b: any) => b.legacyRef === `ref:${ref}`,
  );
  if (!selected.length) return null;
  if (
    selected.some(
      (b: any) =>
        JSON.stringify(b.tables) !== JSON.stringify(selected[0].tables) ||
        b.version !== selected[0].version,
    )
  )
    throw Error("query_catalog_ambiguous");
  return {
    kind: "dataset",
    tables: selected[0].tables.map((t: any) => ({
      name: t.table,
      columns: t.columns,
    })),
  };
});
const result = compileDataflow(raw, ctx, split.body);
if (!result.ok) throw Error("query_flow_refused");
const module = await compileLegacyServerModule(split.content.serverScript, {
  values: raw.values
    .filter((v: any) => v.kind === "scalar")
    .map((v: any) => v.name),
  queries: raw.queries.map((q: any) => q.name),
  mutations: raw.mutations.map((m: any) => m.name),
});
const manifest = {
  values: result.compiled.values
    .filter((v: any) => v.kind === "scalar")
    .map((v: any) => v.name),
  queries: result.compiled.queries.map((q: any) => q.name),
  mutations: result.compiled.mutations.map((m: any) => m.name),
  resets: Object.fromEntries(
    result.compiled.mutations
      .filter((m: any) => m.reset?.length)
      .map((m: any) => [m.name, m.reset]),
  ),
  defaults: Object.fromEntries(
    result.compiled.values
      .filter((v: any) => v.kind === "scalar")
      .map((v: any) => [v.name, v.default]),
  ),
};
const resolver = await compileProgramResolver(
  split.content.serverScript,
  manifest,
);
process.stdout.write(
  JSON.stringify({
    flow: result.compiled,
    module,
    program: { resolver, manifest },
  }),
);
