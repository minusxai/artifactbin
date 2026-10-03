// Validation only. Native branch snapshots are exact copies at 0eb28194.
// The store below is deliberately a fixture, not a second product dataflow engine.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const directory = fileURLToPath(new URL(".", import.meta.url));
export async function bundlePageFixture(
  script,
  { initializePending = true } = {},
) {
  const native = await readFile(
    new URL("./fixtures/native-page-runtime.ts.txt", import.meta.url),
    "utf8",
  );
  const compiler = await readFile(
    new URL("./fixtures/native-author-module.ts.txt", import.meta.url),
    "utf8",
  );
  // Extract the pure generator verbatim; the rest of the browser compiler allows CDN imports.
  const generator =
    compiler.match(/export const PAGE_GLOBAL = [^;]+;/)[0] +
    "\n" +
    compiler.slice(
      compiler.indexOf("const NAME_RE"),
      compiler.indexOf("const cache ="),
    );
  const generated = await build({
    stdin: { contents: generator, loader: "ts" },
    format: "esm",
    write: false,
  });
  const { pageModuleSource } = await import(
    "data:text/javascript;base64," +
      Buffer.from(generated.outputFiles[0].text).toString("base64")
  );
  const page =
    "import 'fixture:store';\n" +
    pageModuleSource({
      values: ["region"],
      queries: ["monthly"],
      mutations: ["rename"],
    });
  const store = `import { bindPage } from 'fixture:native';
const capability = globalThis.__capabilities;
let state = { values: { region: 'west' }, tables: {}, errors: {} };
let generation = 0;
const listeners = new Set();
const pending = new Set(['monthly']);
function notify() { for (const fn of listeners) fn(); }
async function refresh() {
  const version = ++generation;
  pending.add('monthly'); notify();
  try {
    const result = await capability.artifactbin.read({ name: 'monthly', params: { region: state.values.region } });
    if (version !== generation) return;
    state.tables.monthly = result; delete state.errors.monthly;
  } catch (error) {
    if (version !== generation) return;
    state.errors.monthly = error.message;
  }
  pending.delete('monthly'); notify();
}
const store = {
  flow: { values: [{ name: 'region', kind: 'scalar', type: 'string' }], queries: [{ name: 'monthly' }], mutations: [{ name: 'rename' }] },
  getState: () => state, pending: () => pending,
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  setValue: (name, value) => { state.values[name] = value; void refresh(); },
  mutate: async (name, args) => { await capability.artifactbin.reply({ name, args }); await refresh(); },
};
export const bindings = bindPage(store);
globalThis.__mxPageBindings = bindings;
${initializePending ? "notify();" : ""}
export const start = refresh;
export const dispose = () => bindings.dispose();`;
  const modules = {
    "fixture:entry": `import run from 'fixture:script';
import { start, dispose } from 'fixture:store';
export default async function(input, context) {
  const initial = start();
  try { return await run(input, context); }
  finally { await initial; dispose(); }
}`,
    "fixture:script": script,
    "fixture:store": store,
    "fixture:native": native,
    page,
  };
  const out = await build({
    absWorkingDir: directory,
    entryPoints: ["fixture:entry"],
    platform: "browser",
    format: "iife",
    globalName: "Program",
    bundle: true,
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "fixture",
        setup(b) {
          b.onResolve({ filter: /^(fixture:|page$)/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: modules[args.path],
            loader: "ts",
            resolveDir: directory,
          }));
        },
      },
    ],
  });
  return out.outputFiles[0].text;
}
// Directly exercise the native binder against a cold pending store, without our fixture bootstrap.
export async function probeNativeColdReady() {
  const native = await readFile(
    new URL("./fixtures/native-page-runtime.ts.txt", import.meta.url),
    "utf8",
  );
  const out = await build({
    absWorkingDir: directory,
    stdin: { contents: native, loader: "ts", resolveDir: directory },
    platform: "node",
    format: "esm",
    bundle: true,
    write: false,
    logLevel: "silent",
  });
  const { bindPage } = await import(
    "data:text/javascript;base64," +
      Buffer.from(out.outputFiles[0].text).toString("base64")
  );
  let listener;
  const state = { values: {}, tables: {}, errors: {} };
  const pending = new Set(["monthly"]);
  const bindings = bindPage({
    flow: { values: [], queries: [{ name: "monthly" }], mutations: [] },
    getState: () => state,
    pending: () => pending,
    subscribe: (fn) => {
      listener = fn;
      return () => {};
    },
  });
  const q = bindings.query("monthly");
  const before = { loading: q.loading.value, rows: await q.ready };
  listener();
  const afterLoading = q.loading.value;
  let settled = false;
  const ready = q.ready.then((rows) => {
    settled = true;
    return rows;
  });
  await Promise.resolve();
  const waited = !settled;
  state.tables.monthly = { rows: [{ total: 42 }] };
  pending.clear();
  listener();
  const rows = await ready;
  bindings.dispose();
  return { before, afterLoading, waited, rows };
}
