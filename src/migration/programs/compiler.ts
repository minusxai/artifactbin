import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse } from "acorn";
import { build } from "esbuild";
import type {
  CompileProgramResolver,
  ProgramBindingManifest,
} from "./runtime-contracts.ts";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Node = { type: string; [key: string]: any };
const forbidden = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "importScripts",
  "eval",
  "Function",
  "globalThis",
  "window",
  "document",
  "self",
  "navigator",
  "constructor",
  "__proto__",
  "process",
  "require",
  "setTimeout",
  "setInterval",
]);
function admit(script: string, manifest: ProgramBindingManifest) {
  const ast = parse(script, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as Node;
  const imports = new Map<string, "signal" | "query" | "mutation">();
  let defaultExport = false;
  for (const node of ast.body as Node[]) {
    if (node.type === "ExportDefaultDeclaration") defaultExport = true;
    if (node.type !== "ImportDeclaration") continue;
    if (node.source.value !== "page") throw Error("Unsupported program module");
    for (const spec of node.specifiers) {
      if (
        spec.type !== "ImportSpecifier" ||
        !["signal", "query", "mutation"].includes(spec.imported.name)
      )
        throw Error("Unsupported program binding import");
      imports.set(spec.local.name, spec.imported.name);
    }
  }
  if (!defaultExport) throw Error("Program must default-export a handler");
  const visit = (node: unknown, parent?: Node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, parent));
      return;
    }
    const n = node as Node;
    if (
      n.type === "ImportExpression" ||
      n.type === "ExportAllDeclaration" ||
      (n.type === "ExportNamedDeclaration" && n.source)
    )
      throw Error("Dynamic or re-exported program module");
    if (
      (n.type === "Identifier" && forbidden.has(n.name)) ||
      (n.type === "Literal" && forbidden.has(n.value))
    )
      throw Error("Unsupported program host capability");
    if (
      n.type === "Identifier" &&
      imports.has(n.name) &&
      parent?.type !== "ImportSpecifier"
    ) {
      if (parent?.type !== "CallExpression" || parent.callee !== n)
        throw Error("Binding imports must be called directly");
      const args = parent.arguments;
      const kind = imports.get(n.name)!;
      const names =
        kind === "signal"
          ? manifest.values
          : kind === "query"
            ? [...manifest.queries, ...(manifest.tables ?? [])]
            : manifest.mutations;
      if (
        args.length !== 1 ||
        args[0].type !== "Literal" ||
        typeof args[0].value !== "string" ||
        !args[0].value.startsWith("$") ||
        !names.includes(args[0].value.slice(1))
      )
        throw Error("Undeclared program binding");
    }
    for (const [key, value] of Object.entries(n))
      if (!["start", "end", "loc"].includes(key)) visit(value, n);
  };
  visit(ast);
}
/** Compiles only the fixed offline module graph; archived source is never evaluated here. */
export const compileProgramResolver: CompileProgramResolver = async (
  script,
  manifest,
  limits,
) => {
  if (limits && limits.outputBytes !== 65536)
    throw Error("Invalid program output limit");
  admit(script, manifest);
  const identifiers = JSON.stringify(
    parse(script, { ecmaVersion: "latest", sourceType: "module" }),
  );
  let prefix = "__program";
  while (script.includes(prefix) || identifiers.includes(prefix)) prefix += "_";
  const author = await build({
    stdin: { contents: script, loader: "js" },
    bundle: true,
    write: false,
    format: "iife",
    globalName: prefix + "Author",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    plugins: [
      {
        name: "owned-program-page",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            args.path === "page"
              ? { path: "page", namespace: "program" }
              : { errors: [{ text: "Unsupported program module" }] },
          );
          b.onLoad({ filter: /.*/, namespace: "program" }, () => ({
            contents: ["signal", "query", "mutation"]
              .map(
                (name) =>
                  `export const ${name}=(ref)=>${prefix}Runtime.bindings.${name}(ref);`,
              )
              .join("\n"),
            loader: "js",
          }));
        },
      },
    ],
  });
  const runtime = await build({
    stdin: {
      contents: `export {createProgramBindings} from ${JSON.stringify(fileURLToPath(new URL("../../programs/runtime.ts", import.meta.url)))};export {assertStorable} from ${JSON.stringify(fileURLToPath(new URL("../../apollo/storable.ts", import.meta.url)))};`,
      loader: "js",
      resolveDir: dirname(fileURLToPath(import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: prefix + "Library",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  const source = `${runtime.outputFiles[0]!.text}
export const typeDefs='type Query{programAvailable:Boolean!} type Mutation{run(inputJson:String!):String!}';
export default {Query:{programAvailable:()=>true},Mutation:{run:async(${prefix}Args,${prefix}Principal,${prefix}Caps)=>{
 const ${prefix}Encode=value=>{${prefix}Library.assertStorable(value);const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>${limits?.outputBytes ?? 8192})throw Error('Program JSON exceeds limit');return text;};
 if(typeof ${prefix}Args.inputJson!=='string'||new TextEncoder().encode(${prefix}Args.inputJson).length>8192)throw Error('Program JSON exceeds limit');
 const ${prefix}Input=JSON.parse(${prefix}Args.inputJson);${prefix}Encode(${prefix}Input);
 const ${prefix}Call=(operation,input)=>${prefix}Caps.invoke({resource:'program-bindings',operation,input});
 const ${prefix}Runtime=${prefix}Library.createProgramBindings(${JSON.stringify(manifest)},{authorize:()=>${prefix}Call('authorize',{}),query:(name,values)=>${prefix}Call('query',{name,values}),mutate:(name,args,row,operationId,values)=>${prefix}Call('mutate',{name,args:{...args},...(row?{row:{...row}}:{}),operationId,values})});
 try{await ${prefix}Runtime.start();${author.outputFiles[0]!.text}
 if(typeof ${prefix}Author.default!=='function')throw Error('Program default export must be a function');
 const ${prefix}Output=await ${prefix}Author.default(${prefix}Input);await ${prefix}Runtime.drain();return ${prefix}Encode(${prefix}Output);
 }finally{await ${prefix}Runtime.close();}
}}};`;
  return {
    ...(limits ? { outputBytes: limits.outputBytes } : {}),
    source,
    sourceSha256: digest(source),
    scriptSha256: digest(script),
    operation: "Mutation.run",
    reuse: "one-shot",
    activation: "not-activated",
  };
};
