/** Migration subprocess only: archived compiler dependencies never enter the product package graph. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
if (
  !split ||
  split.content.script ||
  split.content.queries.length ||
  split.content.mutations.length ||
  split.content.imports.length
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
  chrome: false,
});
if (parts.runtime.authorScript || parts.runtime.authorScriptErrors?.length)
  throw Error("Author code is not supported");
const build = loadCompilerBuild();
const declarations = split.content.values.map((v: any) => ({
  name: v.name,
  type: v.type,
  default: v.default,
}));
if (
  declarations.some(
    (v: any) =>
      !["string", "number", "boolean"].includes(v.type) ||
      (v.default !== null && typeof v.default !== v.type),
  )
)
  throw Error("Unsupported value type");
const flow = {
  imports: [],
  queries: [],
  mutations: [],
  values: split.content.values,
};
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
  values: Object.fromEntries(declarations.map((d: any) => [d.name, d.default])),
  results: null,
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
  browser + "\nimport {boot} from '@mx/boot';boot({TREE:Document});",
  { generate: "dom", hydratable: true },
  { moduleName: "@mx/rt" },
);
const manifest = JSON.parse(
  await readFile(
    path.join(root, "services/app/public/islands/manifest.json"),
    "utf8",
  ),
).manifest;
const { build: bundle } = await import(
  pathToFileURL(path.join(root, "node_modules/esbuild/lib/main.js")).href
);
const bundled = await bundle({
  stdin: { contents: source, resolveDir: path.join(root, "services/app") },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  minify: true,
  treeShaking: true,
  metafile: true,
  external: ["@afbin/apollo"],
  plugins: [
    {
      name: "migration-only",
      setup(b: any) {
        b.onResolve({ filter: /^@mx\/boot$/ }, () => ({
          path: "local",
          namespace: "migration",
        }));
        b.onLoad({ filter: /.*/, namespace: "migration" }, () => ({
          contents: localBootSource(declarations),
          loader: "js",
        }));
        b.onResolve({ filter: /^(@mx\/|solid-js)/ }, (args: any) => {
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
