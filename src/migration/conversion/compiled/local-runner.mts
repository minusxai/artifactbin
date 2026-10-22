/** Migration subprocess only: archived compiler dependencies never enter the product package graph. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareAuthorBundle } from "./author/compiler.ts";
import { rewriteCompiledMounts } from "./author-document.ts";
import { prepareLocalFlow } from "./local-engine.ts";
import { localBootSource } from "./local-boot.ts";
import type { CompiledMigrationInput } from "./contracts.ts";
const root = path.resolve(process.argv[2] ?? "");
const archived = (relative: string) =>
  import(pathToFileURL(path.join(root, "services/app", relative)).href);
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > 9 * 1024 * 1024)
    throw Error("Input exceeds limit");
}
const input = JSON.parse(text) as CompiledMigrationInput;
const { storyBodyFor } = await archived("lib/document/body.ts");
const split = storyBodyFor(input.source);
if (!split || split.content.script || split.content.mutations.length)
  throw Error("Only local scalar documents admitted");
const [
  { prepareStoryParts },
  { compileStoryCss },
  { generate },
  { loadKitServer, ssrModuleCode, ssrModuleOf, transformSolid },
  { loadCompilerBuild },
  { documentStyleSheets },
  { inlineStoryElement },
] = await Promise.all([
  archived("lib/publish/prepared/prepare-runtime.server.ts"),
  archived("lib/data/story/story-css.server.ts"),
  archived("lib/compiled-page/compiler.ts"),
  archived("lib/compiled-page/bundle.server.ts"),
  archived("lib/compiled-page/build.server.ts"),
  archived("lib/page-styles/document-styles.ts"),
  archived("lib/compiled-page/story-element.ts"),
]);
const compiledCss = await compileStoryCss(input.source);
const parts = await prepareStoryParts({
  source: input.source,
  compiledCss,
  theme: input.theme ?? null,
  template: input.template ?? null,
  colorMode: input.colorMode ?? "light",
  title: null,
  refData: {},
  chrome: false,
});
if (parts.runtime.authorScript || parts.runtime.authorScriptErrors?.length)
  throw Error("Author code is not supported");
const build = loadCompilerBuild();
const author = input.authorPlan
  ? await prepareAuthorBundle(
      input.authorPlan.script,
      {
        values: split.content.values
          .filter((v: any) => v.kind === "scalar")
          .map((v: any) => v.name),
        tables: split.content.values
          .filter((v: any) => v.kind === "table")
          .map((v: any) => v.name),
        queries: split.content.queries.map((q: any) => q.name),
        mutations: [],
      },
      { archivedRoot: root },
    )
  : null;
if (
  author &&
  input.authorPlan!.exports.some((name) => !author.exports.includes(name))
)
  throw Error("Author export mismatch");
const declarations = split.content.values.map((v: any) =>
  v.kind === "table"
    ? {
        name: v.name,
        type: "table",
        default: v.rows ?? [],
        columns: v.columns ?? [],
      }
    : { name: v.name, type: v.type, default: v.default },
);
const { validLocalValue } = await import("./local-state.ts");
if (declarations.some((v: any) => !validLocalValue(v, v.default)))
  throw Error("Unsupported local value type");
const scalarValues = Object.fromEntries(
  declarations
    .filter((d: any) => d.type !== "table")
    .map((d: any) => [d.name, d.default]),
);
const localTables = Object.fromEntries(
  declarations
    .filter((d: any) => d.type === "table")
    .map((d: any) => [d.name, d.default]),
);
const rawFlow = {
  imports: split.content.imports,
  queries: split.content.queries,
  mutations: [],
  values: split.content.values,
};
let flow: any = rawFlow;
let results: any = null;
if (rawFlow.queries.length) {
  ({ flow, results } = await prepareLocalFlow(
    archived,
    rawFlow,
    split.body,
    scalarValues,
    localTables,
    input.datasetBindings ?? [],
  ));
} else if (rawFlow.imports.length) throw Error("Import requires a query");
const generated = generate({
  nodes: parts.runtime.data.nodes,
  colorMode: parts.mode,
  template: input.template ?? null,
  chrome: false,
  glyphs: parts.runtime.data.glyphs,
  refData: {},
  flow,
  build: build.id,
  kitServer: await loadKitServer(),
});
if (
  generated.unported.length ||
  generated.partial.length ||
  generated.behaviors.length
)
  throw Error("Interactive behavior requires a migration adapter");
const rendered = (
  await ssrModuleOf(
    await ssrModuleCode(
      generated.skeleton,
      flow,
      generated.staticTexts,
      generated.staticHtml,
    ),
    "migration-local",
  )
).render({
  values: scalarValues,
  localTables,
  results,
  mermaidImages: {},
  drawings: {},
});
const { MODULE_DATA_READ_CODE } = await archived(
  "lib/compiled-page/carriers.ts",
);
let browser = generated.browserIslands ?? generated.islands;
if (browser.includes(MODULE_DATA_READ_CODE))
  browser = browser.replace(
    MODULE_DATA_READ_CODE,
    `const $moduleData=${JSON.stringify(generated.moduleData.map((v: string) => JSON.parse(v)))};\n`,
  );
const source = await transformSolid(
  (author ? rewriteCompiledMounts(browser) : browser) +
    "\nimport {boot} from '@mx/boot';boot({TREE:Document});",
  { generate: "dom", hydratable: true },
  { moduleName: "@mx/rt" },
);
const buildManifest = JSON.parse(
  await readFile(
    path.join(root, "services/app/public/islands/manifest.json"),
    "utf8",
  ),
);
const manifest = buildManifest.manifest;
let sql: any;
if (flow.queries.length) {
  const wasm = await readFile(
    path.join(root, "services/app/public", buildManifest.sqliteWasm),
  );
  sql = {
    flow,
    wasmBase64: wasm.toString("base64"),
    tables: results.tables,
    bindings: input.datasetBindings ?? [],
  };
}
const sqlitePath = Object.keys(buildManifest.files).find((v: string) =>
  /^\/islands\/sqlite-engine-[a-f0-9]+\.js$/.test(v),
);
const { build: bundle, transform: stripTypes } = await import(
  pathToFileURL(path.join(root, "node_modules/esbuild/lib/main.js")).href
);
const bundled = await bundle({
  stdin: { contents: source, resolveDir: path.join(root, "services/app") },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  alias: { "@": path.join(root, "services/app") },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  minify: true,
  treeShaking: true,
  metafile: true,
  external: ["@afbin/apollo"],
  plugins: [
    {
      name: "migration-only",
      setup(b: any) {
        b.onResolve({ filter: /^@artifactbin\/contracts$/ }, () => ({
          path: "scalar-query-contracts",
          namespace: "migration-contracts",
        }));
        b.onLoad({ filter: /.*/, namespace: "migration-contracts" }, () => ({
          contents: [
            ["sql.ts", "DISPLAY_ROWS,isQueryFailure"],
            ["sql-analysis.ts", "paramSqlName"],
            ["sql-functions.ts", "SQL_FUNCTIONS,MUTATION_ONLY_FUNCTIONS"],
            [
              "artifact-reference.ts",
              "ARTIFACT_ID_PATTERN,ARTIFACT_REFERENCE_PATTERN",
            ],
            ["membership.ts", "MEMBER_COLUMNS"],
          ]
            .map(
              ([file, names]) =>
                `export {${names}} from ${JSON.stringify(path.join(root, "services/contracts/src", file))};`,
            )
            .join("\n"),
          loader: "js",
          resolveDir: root,
        }));
        b.onLoad({ filter: /\.tsx$/ }, async (args: any) => {
          if (!args.path.startsWith(path.join(root, "services/app/")))
            throw Error("Unexpected TSX dependency");
          const stripped = await stripTypes(await readFile(args.path, "utf8"), {
            loader: "tsx",
            jsx: "preserve",
          });
          return {
            contents: await transformSolid(
              stripped.code,
              { generate: "dom", hydratable: true },
              { moduleName: "solid-js/web" },
            ),
            loader: "js",
            resolveDir: path.dirname(args.path),
          };
        });
        b.onResolve({ filter: /^@mx\/boot$/ }, () => ({
          path: "local",
          namespace: "migration",
        }));
        b.onLoad({ filter: /.*/, namespace: "migration" }, () => ({
          contents: localBootSource(declarations, sql, input.authorPlan),
          loader: "js",
        }));
        b.onResolve(
          {
            filter:
              /^(migration-author-entry|migration-author-ports|authored-module|author-closure)$/,
          },
          (args: any) => {
            if (!author) throw Error("No author plan");
            return args.path === "migration-author-ports"
              ? {
                  path: path.join(
                    import.meta.dirname,
                    "author/apollo-ports.ts",
                  ),
                }
              : { path: args.path, namespace: "migration-author" };
          },
        );
        b.onLoad(
          { filter: /.*/, namespace: "migration-author" },
          (args: any) => ({
            contents:
              args.path === "migration-author-entry"
                ? author!.entry
                : args.path === "author-closure"
                  ? author!.closureModule
                  : author!.authorModule,
            loader: "js",
            resolveDir: root,
          }),
        );
        b.onResolve({ filter: /^migration-datasets$/ }, () => ({
          path: path.join(import.meta.dirname, "dataset-reader.ts"),
        }));
        b.onResolve({ filter: /^migration-sqlite$/ }, () => {
          if (!sqlitePath) throw Error("No archived SQLite engine");
          return {
            path: path.join(root, "services/app/lib/islands/sqlite-engine.ts"),
          };
        });
        b.onResolve({ filter: /^(@mx\/|solid-js)/ }, (args: any) => {
          if ((sql || author) && args.path.startsWith("solid-js")) {
            const suffix = args.path.slice("solid-js".length);
            const file =
              suffix === ""
                ? "dist/solid.js"
                : suffix + "/dist/" + suffix.slice(1) + ".js";
            return { path: path.join(root, "node_modules/solid-js", file) };
          }
          if (
            (sql || author) &&
            (args.path === "@mx/rt" || args.path.startsWith("@mx/kit/"))
          ) {
            const relative =
              args.path === "@mx/rt"
                ? "rt.tsx"
                : args.path.replace("@mx/", "") + ".tsx";
            return {
              path: path.join(root, "services/app/lib/islands", relative),
            };
          }
          const file = manifest[args.path];
          if (!file) throw Error("Unmapped archived browser import");
          return { path: path.join(root, "services/app/public", file) };
        });
      },
    },
  ],
});
const javascript = bundled.outputFiles[0].text;
const bundleOutput: any = Object.values(bundled.metafile.outputs)[0];
if (
  bundleOutput.imports.some(
    (v: any) => !v.external || v.path !== "@afbin/apollo",
  )
)
  throw Error("Unexpected browser import");
const modules = Object.entries(bundleOutput.inputs)
  .filter(
    ([v, info]: any) =>
      info.bytesInOutput > 0 && !v.startsWith("migration:") && v !== "<stdin>",
  )
  .map(([v]) => path.basename(v));
if (/\/api\/|\/islands\/|EventSource|WebSocket|@mx\/boot/.test(javascript))
  throw Error("Legacy platform transport in browser bundle");
const sheets = documentStyleSheets({
  compiledCss,
  chrome: false,
  bare: false,
  theme: input.theme ?? null,
  docFonts: parts.docFonts,
  systemCss: parts.baseRecipe.systemCss ?? "",
  authorCss: parts.runtime.authorCss,
});
let css = sheets.map((sheet: { css: string }) => sheet.css).join("\n");
// No network, old origin, asset endpoint or deployment host is carried into migrated styles.
const { parse: parseCss, walk: walkCss } = await import("css-tree");
const cssTree = parseCss(css, { positions: true });
const urls: Array<{
  value: string;
  loc: { start: { offset: number }; end: { offset: number } };
}> = [];
walkCss(cssTree, (node: any) => {
  if (node.type === "Url") urls.push(node);
});
const replacements: Array<{ start: number; end: number; text: string }> = [];
for (const node of urls) {
  const url = node.value;
  if (url.startsWith("data:") || url.startsWith("#")) continue;
  if (!/^\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(url))
    throw Error("Unresolved stylesheet resource");
  const bytes = await readFile(path.join(root, "services/app/public", url));
  replacements.push({
    start: node.loc.start.offset,
    end: node.loc.end.offset,
    text: `url("data:font/woff2;base64,${bytes.toString("base64")}")`,
  });
}
for (const replacement of replacements.sort((a, b) => b.start - a.start))
  css =
    css.slice(0, replacement.start) +
    replacement.text +
    css.slice(replacement.end);
if (/@import\s/i.test(css))
  throw Error("External stylesheet imports are not self-contained");
const html = inlineStoryElement(rendered, parts.mode, input.theme ?? null);
process.stdout.write(
  JSON.stringify({
    html,
    css,
    javascript,
    declarations,
    authorExports: author?.exports ?? [],
    datasetNames: flow.imports.map((i: any) => i.name),
    queryNames: flow.queries.map((q: any) => q.name),
    modules,
    title: parts.title,
    build: build.id,
    rootAttributes: {
      class: parts.mode,
      ...(input.theme ? { "data-theme": input.theme } : {}),
    },
    capabilities: ["local-scalars", "inlined-fonts"],
  }),
);
