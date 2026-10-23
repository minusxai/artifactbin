import { readHistoricalRemoteMutationNames } from "./historical-mutations.ts";
import {archivedScalarChoiceSource} from "./scalar-choice-kit-source.ts";
import { validCompiledBrowserImports } from "./browser-imports.ts";
import { archivedRuntimePlan } from "./runtime-plan.ts";
import {archivedDialogMutationFormSource} from "./dialog-form-source.ts";
import {prepareCompiledFileUploads} from "./file-upload-admission.ts";
import {archivedFileUploadControlSource} from "./file-upload-kit-source.ts";
import { archivedDialogFocusSource } from "./dialog-source.ts";
import {readLegacyCellWriteSites} from "./cell-write-source.ts";
import {prototypeMermaidContext} from "./prototype-mermaid-context.ts";
import {validateCompiledTransport} from "./transport.ts";
import {isolateArchivedThemeVariables} from "./legacy-theme.ts";
import{readsLegacyViewer}from"./viewer-source.ts";
import {validateCompiledCellWriteContexts} from "./cell-write-context.ts";
import {archivedExplicitCellOptionsSource} from "./cell-kit-source.ts";
import {inlinePinnedFontImports} from "./fonts/inline.ts";
import {prepareArchivedFontResources} from "./fonts/captured.ts";
import {prepareArchivedMermaid} from "./mermaid-prepare.ts";
import {mermaidRuntimeSource} from "./mermaid-runtime.ts";
import {readsLegacyMembers} from "./members-source.ts";
import { archivedPersonProfileSource } from "./person-profile.ts";
import { preservePresentationHosts } from "./presentation-hosts.ts";
import {forwardArchivedMembersContext} from "./members-engine.ts";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  MAX_PACKED_WASM_BYTES,
  MAX_UNPACKED_WASM_BYTES,
} from "./wasm-contracts.ts";
/** Migration subprocess only: archived compiler dependencies never enter the product package graph. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareArchivedChartPlans } from "./charts/archived.ts";
import { chartRendererSources } from "./charts/renderer-source.ts";
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
const prototype=input.sourceAdmission==="offline-prototype";
const attachmentSites=prepareCompiledFileUploads(input.source,input.datasetAttachments??[],input.datasetBindings??[]);
const { storyBodyFor } = await archived("lib/document/body.ts");
const split = storyBodyFor(input.source);
const historicalRemoteMutations = input.datasetUnavailable
  ? readHistoricalRemoteMutationNames(input.source)
  : [];
if (
  !split ||
  split.content.script ||
  (!input.datasetUnavailable &&
    split.content.mutations.length !== (input.datasetMutations ?? []).length + (prototype?input.localMutationNames?.length??0:0))
)
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
  chrome: Boolean(input.slideDeck),
});
if (parts.runtime.authorScript || parts.runtime.authorScriptErrors?.length)
  throw Error("Author code is not supported");
const presentationNodes = preservePresentationHosts(
  parts.runtime.data.nodes,
  input.presentationIdentities ?? [],
);
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
        mutations: input.datasetMutations?.map(binding => binding.name) ?? [],
      },
      {
        archivedRoot: root,
        mode: input.authorPlan.mode,
        lifecycle: input.authorPlan.lifecycle,
        sourceAdmission:input.sourceAdmission,
      },
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
  mutations: prototype&&input.localMutationNames?.length ? split.content.mutations : [],
  values: split.content.values,
};
if(input.sourceQueries?.length&&!rawFlow.queries.length)throw Error("Unused source query proof");
let flow: any = rawFlow;
let results: any = null;
if(!prototype&&input.viewerBinding&&!(await readsLegacyViewer(input.source)))throw Error("Unused viewer binding");
if (input.datasetUnavailable) {
  const bound=rawFlow.values.some((v:any)=>v.kind==="scalar"&&typeof v.source==="string"&&v.source.length>0);
  if(!rawFlow.imports.length&&!bound&&!historicalRemoteMutations.length&&!(await readsLegacyMembers(input.source))&&!(await readsLegacyViewer(input.source)))throw Error("Historical service dependency missing");
  flow = { ...rawFlow, imports: [], queries: [], values:rawFlow.values.map((v:any)=>{
    const {source,column,constraints,...local}=v;void source;void column;void constraints;return local;
  }) };
  results = { tables: {}, errors: {} };
} else if (rawFlow.queries.length || rawFlow.mutations.length) {
  ({ flow, results } = await prepareLocalFlow(
    archived,
    rawFlow,
    split.body,
    scalarValues,
    localTables,
    input.datasetBindings ?? [],
    input.boundValueColumns ?? [],
    input.membersBinding,
    input.viewerBinding,
    input.sourceAdmission,
    input.sourceQueries??[],
  ));
} else if (rawFlow.imports.length) throw Error("Import requires a query");
if(!input.datasetUnavailable&&input.datasetMutations?.some(binding=>binding.valueParam))validateCompiledCellWriteContexts(input.source,flow,input.datasetMutations??[],input.sourceAdmission);
const hasCharts = (nodes: readonly any[]): boolean =>
  nodes.some(
    (n) =>
      n.type === "element" &&
      (["Question", "Chart"].includes(n.tag) || hasCharts(n.children ?? [])),
  );
let archivedChartController = false;
let chartPlans: import("./charts/contracts.ts").CompiledChartPlan[] = [];
try {
  chartPlans = hasCharts(presentationNodes)
    ? await prepareArchivedChartPlans(presentationNodes, archived, root, {
        colorMode: parts.mode,
        sourceAdmission: input.sourceAdmission,
        tables:
          results?.tables ??
          Object.fromEntries(
            declarations
              .filter((d: any) => d.type === "table")
              .map((d: any) => [
                d.name,
                { columns: d.columns, rows: d.default },
              ]),
          ),
      })
    : [];
} catch (error) {
  if (!prototype) throw error;
  archivedChartController = true;
}
const chartSources = archivedChartController
  ? {
      entry: `import * as charts from ${JSON.stringify(path.join(root, "services/app/lib/islands/chart-controller.ts"))};export {charts};`,
      plugin: { name: "prototype-archived-chart-controller", setup() {} },
    }
  : chartPlans.length
    ? await chartRendererSources(root, chartPlans)
    : null;
const generated = generate({
  nodes: presentationNodes,
  colorMode: parts.mode,
  template: input.template ?? null,
  chrome: Boolean(input.slideDeck),
  glyphs: parts.runtime.data.glyphs,
  refData: {},
  flow,
  build: build.id,
  kitServer: await loadKitServer(),
});
if (!prototype && (
  generated.unported.length ||
  generated.partial.length ||
  generated.behaviors.some((behavior:string)=>behavior!=="@mx/deck" || !input.slideDeck || input.slideDeck.slides.length<2)
))
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
const sheets = documentStyleSheets({
  compiledCss,
  chrome: Boolean(input.slideDeck),
  bare: false,
  theme: input.theme ?? null,
  docFonts: parts.docFonts,
  systemCss: parts.baseRecipe.systemCss ?? "",
  authorCss: parts.runtime.authorCss,
});
let css = sheets.map((sheet: { css: string }) => sheet.css).join("\n");
css = isolateArchivedThemeVariables(css);
const archivedFonts = await prepareArchivedFontResources(root, process.argv[3] ? JSON.parse(process.argv[3]) : undefined);
const fontResources = await inlinePinnedFontImports(css, archivedFonts.resolve,prototype?"preserve-unresolved":"strict");
css = fontResources.css;
// Strict conversion requires closed styles; prototype conversion preserves authored resource behavior.
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
  if (!/^\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(url)){
    if(prototype)continue;
    throw Error("Unresolved stylesheet resource");
  }
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
if (!prototype && /@import\s/i.test(css))
  throw Error("External stylesheet imports are not self-contained");
const html = inlineStoryElement(rendered, parts.mode, input.theme ?? null);

const preparedMermaids=await prepareArchivedMermaid(root,prototype?prototypeMermaidContext({html,css,plans:input.mermaids??[]}):{html,css,plans:input.mermaids??[]}).catch(error=>{if(!prototype)throw error;return [];});
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
if ((flow.queries.length || flow.mutations.length) && !input.datasetUnavailable) {
  const wasm = await readFile(
    path.join(root, "services/app/public", buildManifest.sqliteWasm),
  );
  const packed = gzipSync(wasm, { level: 9 });
  if (
    wasm.byteLength > MAX_UNPACKED_WASM_BYTES ||
    packed.byteLength > MAX_PACKED_WASM_BYTES
  )
    throw Error("Embedded engine exceeds migration limit");
  sql = {
    flow,
    sourceQueries:input.sourceQueries??[],
    wasm: {
      compression: "gzip",
      base64: packed.toString("base64"),
      sha256: createHash("sha256").update(wasm).digest("hex"),
      uncompressedBytes: wasm.byteLength,
    },
    tables: results.tables,
    bindings: input.datasetBindings ?? [],
    membersBinding:input.membersBinding,
  };
}
const runtimePlan = archivedRuntimePlan({
  sql: Boolean(sql), author: Boolean(author), charts: Boolean(chartSources),
  datasetMutations: Boolean(input.datasetMutations?.length),
  dataControls: Boolean(input.dataControls?.length), slideDeck: Boolean(input.slideDeck),
  mermaid: Boolean(input.mermaids?.length), dialogFocus: Boolean(input.dialogFocus),
  person: Boolean(input.personBindings?.length), viewer: Boolean(input.viewerBinding),
  members: Boolean(input.membersBinding), fonts: Boolean(fontResources.receipts.length),
  context: Boolean(input.contexts?.length),
});
const sqlitePath = Object.keys(buildManifest.files).find((v: string) =>
  /^\/islands\/sqlite-engine-[a-f0-9]+\.js$/.test(v),
);
const { build: bundle, transform: stripTypes } = await import(
  pathToFileURL(path.join(root, "node_modules/esbuild/lib/main.js")).href
);
const mermaidSource=preparedMermaids.length?await transformSolid(mermaidRuntimeSource(preparedMermaids),{generate:"dom",hydratable:true},{moduleName:"solid-js/web"}):undefined;
const bundled = await bundle({
  stdin: { contents: source, sourcefile:"migration-local-entry.js", resolveDir: path.join(root, "services/app") },
  bundle: true,
  write: false,
  outfile:"migration-local.js",
  sourcemap:preparedMermaids.length?"external":false,
  sourcesContent:true,
  format: "esm",
  platform: "browser",
  alias: { "@": path.join(root, "services/app") },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  minify: true,
  treeShaking: true,
  metafile: true,
  external: ["@afbin/apollo"],
  plugins: [
    ...(chartSources ? [chartSources.plugin] : []),
    {
      name: "migration-only",
      setup(b: any) {
        if (chartSources) {
          b.onResolve({ filter: /^migration-charts$/ }, () => ({
            path: "charts",
            namespace: "migration-charts",
          }));
          b.onLoad({ filter: /.*/, namespace: "migration-charts" }, () => ({
            contents: chartSources.entry,
            loader: "js",
            resolveDir: root,
          }));
        }
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
          let source = await readFile(args.path, "utf8");
          if(args.path===path.join(root,"services/app/lib/islands/kit/controls.tsx"))source=archivedScalarChoiceSource(source);
          if(attachmentSites.length && args.path===path.join(root,"services/app/lib/islands/kit/upload/control.tsx"))source=archivedFileUploadControlSource(source);
          if (input.personBindings?.length && args.path === path.join(root,"services/app/lib/islands/kit/people.tsx")) source = archivedPersonProfileSource({source,coreUrl:input.coreUrl});
          if(input.datasetMutations?.some(binding=>binding.valueParam)&&args.path===path.join(root,"services/app/lib/islands/kit/cells.tsx"))source=archivedExplicitCellOptionsSource(source);
          if (args.path === path.join(root,"services/app/lib/islands/kit/dialog.tsx")) source = archivedDialogMutationFormSource(archivedDialogFocusSource(source,path.join(import.meta.dirname,"dialog-focus.ts")),path.join(import.meta.dirname,"dialog-form.ts"));
          const stripped = await stripTypes(source, {
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
          contents: localBootSource(
            declarations,
            sql,
            input.authorPlan,
            input.datasetUnavailable
              ? rawFlow.queries.map((q: any) => q.name)
              : undefined,
            Boolean(chartSources),
            input.datasetMutations ?? [],
            input.dataControls ?? [],
            input.dynamicIdentities,
            input.slideDeck,
            input.personBindings ?? [],
            input.viewerBinding,
            input.datasetMutations?.some(binding=>binding.valueParam)?readLegacyCellWriteSites(input.source,undefined,input.sourceAdmission).flatMap(site=>site.optionsQuery?[site.optionsQuery]:[]):[],
            attachmentSites,
            input.localMutationNames ?? [],
          ),
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
        b.onResolve({filter:/^@mx\/kit\/mermaid$/},()=>{
          if(prototype&&!preparedMermaids.length)return;
          if(!preparedMermaids.length)throw Error("Mermaid plan missing");
          return {path:"mermaid",namespace:"migration-mermaid"};
        });
        b.onLoad({filter:/.*/,namespace:"migration-mermaid"},async()=>({contents:mermaidSource,loader:"js",resolveDir:root}));
        b.onResolve({filter:/^migration-mermaid-theme$/},()=>({path:path.join(root,"services/app/lib/islands/kit/theme-watch.ts")}));
        b.onResolve({filter:/^migration-deck$/},()=>({path:path.join(import.meta.dirname,"deck-runtime.ts")}));
        b.onResolve({filter:/^migration-source-queries$/},()=>({path:path.join(import.meta.dirname,"source-query-runtime.ts")}));
        b.onResolve({filter:/^migration-query-controller$/},()=>({path:path.join(import.meta.dirname,"query-controller.ts")}));
        b.onResolve({ filter: /^migration-readiness$/ }, () => ({
          path: path.join(import.meta.dirname, "readiness.ts"),
        }));
        b.onResolve({ filter: /^\.\.\/defer-engine$/ }, (args: any) =>
          args.importer ===
          path.join(root, "services/app/lib/islands/kit/disclosure.tsx")
            ? { path: path.join(import.meta.dirname, "readiness.ts") }
            : undefined,
        );
        b.onResolve({ filter: /^migration-identities$/ }, () => ({
          path: path.join(import.meta.dirname, "dynamic-identity-dom.ts"),
        }));
        b.onResolve({filter:/^migration-file-uploads$/},()=>({path:path.join(import.meta.dirname,"file-upload-runtime.ts")}));
        b.onResolve({filter:/^migration-mutation-availability$/},()=>({path:path.join(import.meta.dirname,"mutation-availability.ts")}));
        b.onResolve({ filter: /^migration-mutations$/ }, () => ({
          path: path.join(
            path.dirname(new URL(import.meta.url).pathname),
            "dataset-mutations.ts",
          ),
        }));
        b.onResolve({ filter: /^migration-datasets$/ }, () => ({
          path: path.join(import.meta.dirname, "dataset-reader.ts"),
        }));
        if(input.membersBinding)b.onLoad({filter:/[\\/]lib[\\/]page-store[\\/]page-engine\.ts$/},async(args:any)=>({contents:forwardArchivedMembersContext(await readFile(args.path,"utf8")),loader:"ts",resolveDir:path.dirname(args.path)}));
        b.onResolve({ filter: /^migration-people$/ },()=>({path:path.join(import.meta.dirname,"person-runtime.ts")}));
        b.onResolve({filter:/^migration-viewer$/},()=>({path:path.join(import.meta.dirname,"viewer-runtime.ts")}));
        b.onResolve({ filter: /^migration-members$/ },()=>({path:path.join(import.meta.dirname,"members-runtime.ts")}));
        b.onResolve({filter:/^migration-scalar-mutations$/},()=>({path:path.join(import.meta.dirname,"scalar-mutations.ts")}));
        b.onResolve({filter:/^migration-local-mutations$/},()=>({path:path.join(import.meta.dirname,"local-mutations.ts")}));
        b.onResolve({ filter: /^migration-sqlite$/ }, () => {
          if (!sqlitePath) throw Error("No archived SQLite engine");
          return {
            path: path.join(root, "services/app/lib/islands/sqlite-engine.ts"),
          };
        });
        b.onResolve({ filter: /^(@mx\/|solid-js)/ }, (args: any) => {
          if (
            runtimePlan.kitGraph === "source" &&
            args.path.startsWith("solid-js")
          ) {
            const suffix = args.path.slice("solid-js".length);
            const file =
              suffix === ""
                ? "dist/solid.js"
                : suffix + "/dist/" + suffix.slice(1) + ".js";
            return { path: path.join(root, "node_modules/solid-js", file) };
          }
          if (
            runtimePlan.kitGraph === "source" &&
            (args.path === "@mx/rt" || args.path.startsWith("@mx/kit/"))
          ) {
            const relative =
              args.path === "@mx/rt"
                ? "rt.tsx"
                : args.path.replace("@mx/", "") +
                  (args.path === "@mx/kit/templates" ? ".ts" : ".tsx");
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
const javascript = bundled.outputFiles.find((file:any)=>file.path.endsWith(".js"))!.text;
const bundleOutput: any = Object.entries(bundled.metafile.outputs).find(([file])=>file.endsWith(".js"))![1];
if (!validCompiledBrowserImports(bundleOutput.imports, prototype))
  throw Error("Unexpected browser import");
const modules = Object.entries(bundleOutput.inputs)
  .filter(
    ([v, info]: any) =>
      info.bytesInOutput > 0 && !v.startsWith("migration:") && v !== "<stdin>",
  )
  .map(([v]) => {
    const relative = v
      .replaceAll("\\", "/")
      .match(/(?:^|\/)node_modules\/(vega-[^/]+\/.+)$/);
    return relative ? relative[1] : path.basename(v);
  });
if(!prototype)validateCompiledTransport({javascript,...(mermaidSource?{sourceMap:bundled.outputFiles.find((file:any)=>file.path.endsWith(".map"))!.text,mermaid:{entry:{name:"migration-local-entry.js",source},runtime:{name:"migration-mermaid:mermaid",source:mermaidSource},plans:preparedMermaids}}:{})});
process.stdout.write(
  JSON.stringify({
    html,
    css,
    javascript,
    declarations,
    authorExports: author?.exports ?? [],
    chartPlans: chartPlans.length,
    chartRuntime: archivedChartController ? "archived-controller" : "compiled-plans",
    datasetNames: rawFlow.imports.map((i: any) => i.name),
    mutationNames: [
      ...new Set([
        ...split.content.mutations.map((m: any) => m.name),
        ...historicalRemoteMutations,
      ]),
    ],
    queryNames: rawFlow.queries.map((q: any) => q.name),
    modules,
    title: parts.title,
    build: build.id,
    rootAttributes: {
      class: parts.mode,
      ...(input.theme ? { "data-theme": input.theme } : {}),
    },
    fontResources: fontResources.receipts,
    ...(archivedFonts.resourceDigest ? {fontBundleResourceDigest:archivedFonts.resourceDigest} : {}),
    capabilities: ["local-scalars", "inlined-fonts"],
  }),
);
