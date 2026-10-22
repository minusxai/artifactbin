import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { admitAuthorSource } from "./admission.ts";
import type {
  AuthorCompilation,
  AuthorNames,
  AuthorBundleSources,
} from "./contracts.ts";
export const PINNED_SOLID_VERSION = "1.9.15";
/** Source compilation only. The authored module is never imported or evaluated here. */
export async function prepareAuthorBundle(
  source: string,
  names: AuthorNames,
  options: { archivedRoot: string },
): Promise<AuthorBundleSources> {
  admitAuthorSource(source);
  if (names.mutations.length) throw Error("Author mutations are unsupported");
  const root = path.resolve(options.archivedRoot);
  const solidRoot = path.join(root, "node_modules/solid-js");
  const pkg = JSON.parse(
    await readFile(path.join(solidRoot, "package.json"), "utf8"),
  );
  if (pkg.version !== PINNED_SOLID_VERSION)
    throw Error("Unexpected archived Solid version");
  const { buildAuthorModule } = await import(
    pathToFileURL(
      path.join(root, "services/app/lib/author-script/author-module.server.ts"),
    ).href
  );
  const result = await buildAuthorModule(source, names);
  if (!result.ok)
    throw Error("Author source refused: " + result.errors.join("; "));
  // The archived compiler emits two generated bridge reads. Rewrite ONLY those reads,
  // after admission has forbidden ambient global access in authored source.
  let replacements = 0;
  const compiled = result.module.code.replace(
    /globalThis\[(?:"__mxPageBindings"|'__mxPageBindings')\]/g,
    () => {
      replacements++;
      return "getAuthorPorts()";
    },
  );
  if (replacements > 2 || compiled.includes("__mxPageBindings"))
    throw Error("Archived author bridge changed");
  const bindingsPath = fileURLToPath(new URL("./bindings.ts", import.meta.url));
  const cleanupPath = fileURLToPath(new URL("./cleanup.ts", import.meta.url));
  const entry = `import {setAuthorPorts} from 'author-closure';
import {createSignal,untrack,createContext,useContext,createComponent} from 'solid-js';
import {render} from 'solid-js/web';
import {createAuthorBindings} from ${JSON.stringify(bindingsPath)};
import {drainAuthorCleanups} from ${JSON.stringify(cleanupPath)};
const MountScope=createContext(null);
const reactive={signal:createSignal,untrack,identity:()=>useContext(MountScope),scope:(identity,fn)=>createComponent(MountScope.Provider,{value:identity,get children(){return fn();}})};
let mounted=false;
export async function mount(ports,mounts){
 if(mounted)throw Error('Author module already mounted');mounted=true;
 const bindings=createAuthorBindings(ports,${JSON.stringify(names)},reactive);
 setAuthorPorts(bindings);
 const stops=[];const identities=new Set();
 try{const components=await import('authored-module');for(const item of mounts){if(identities.has(item.identity))throw Error('Duplicate author mount identity');identities.add(item.identity);const component=components[item.component];if(typeof component!=='function')throw Error('Unknown author component');stops.push(render(()=>bindings.mount(item.identity,()=>component(item.props??{})),item.element));}}
 catch(error){try{drainAuthorCleanups([...stops.splice(0),()=>bindings.dispose()]);}catch(cleanup){throw new AggregateError([error,cleanup],'Author mount failed');}throw error;}
 return ()=>drainAuthorCleanups([...stops.splice(0),()=>bindings.dispose()]);
}`;
  return {
    entry,
    authorModule: `import {getAuthorPorts} from 'author-closure';\n${compiled}`,
    closureModule: `let current;export const getAuthorPorts=()=>current;export const setAuthorPorts=value=>{current=value;};`,
    exports: result.module.exports,
    solidRoot,
  };
}
/** Standalone browser bundle; combined kit builds consume prepareAuthorBundle instead. */
export async function compileAuthorScript(
  source: string,
  names: AuthorNames,
  options: { archivedRoot: string },
): Promise<AuthorCompilation> {
  const prepared = await prepareAuthorBundle(source, names, options);
  const bundled = await build({
    stdin: {
      contents: prepared.entry,
      resolveDir: options.archivedRoot,
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "authorFactory",
    platform: "browser",
    target: "es2022",
    minify: false,
    logLevel: "silent",
    plugins: [
      {
        name: "offline-author",
        setup(b) {
          b.onResolve(
            { filter: /^(authored-module|author-closure)$/ },
            (args) => ({ path: args.path, namespace: "author" }),
          );
          b.onLoad({ filter: /.*/, namespace: "author" }, (args) => ({
            contents:
              args.path === "author-closure"
                ? prepared.closureModule
                : prepared.authorModule,
            loader: "js",
          }));
          b.onResolve({ filter: /^solid-js(?:\/web|\/store)?$/ }, (args) => ({
            path: path.join(
              prepared.solidRoot,
              args.path === "solid-js"
                ? "dist/solid.js"
                : args.path.slice("solid-js/".length) +
                    "/dist/" +
                    args.path.slice("solid-js/".length) +
                    ".js",
            ),
          }));
        },
      },
    ],
  });
  const code = `export function createAuthorModule(){\n${bundled.outputFiles[0]!.text}\nreturn authorFactory;}`;
  return { code, exports: prepared.exports };
}
