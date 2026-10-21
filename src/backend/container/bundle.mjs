// Compilation inside the sandbox, which has no network: esbuild bundles the
// backend file with the npm modules the host fetched from esm.sh
// (src/backend/packages.ts), then the gate checks that the bundle's only
// imports are runtime built-ins. Also imported by the host's tests.
import { build } from "esbuild";
import { parse } from "acorn";

/** The only imports a bundle may keep; src/backend/packages.ts BUILTIN is the same rule. */
export const BUILTIN = /^(?:node|cloudflare):[a-z0-9_/.-]+$/;

const GQL =
  "export function gql(strings, ...values) {" +
  " if (typeof strings === 'string') return strings;" +
  " if (values.length) throw new Error('gql substitutions are not supported');" +
  " return strings[0]; }";

const plain = (x) =>
  x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype;

/**
 * `packages`: each pinned import as written → its module key; `modules`: key →
 * { url, code }. A module's imports resolve against its url and must be keys.
 */
export async function bundleBackend({ source, packages = {}, modules = {} }) {
  if (typeof source !== "string" || !plain(packages) || !plain(modules))
    throw Error("compile request");
  for (const value of Object.values(packages))
    if (typeof value !== "string" || !Object.hasOwn(modules, value))
      throw Error("compile request");
  for (const value of Object.values(modules))
    if (
      !plain(value) ||
      typeof value.url !== "string" ||
      typeof value.code !== "string"
    )
      throw Error("compile request");
  const built = await build({
    stdin: { contents: source, loader: "ts", sourcefile: "backend.ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    logLevel: "silent",
    plugins: [
      {
        name: "backend-imports",
        setup(b) {
          // esbuild uses the first resolver that answers.
          b.onResolve({ filter: /^@afbin\/apollo$/ }, (args) =>
            args.namespace === "npm"
              ? undefined
              : { path: "apollo", namespace: "afbin" },
          );
          b.onLoad({ filter: /.*/, namespace: "afbin" }, () => ({
            contents: GQL,
            loader: "js",
          }));
          b.onResolve({ filter: /.*/ }, (args) => {
            const path = args.path;
            if (BUILTIN.test(path)) return { path, external: true };
            if (args.namespace === "npm") {
              // esm.sh writes `cloudflare:sockets` as a path of its own.
              if (path.startsWith("/cloudflare:")) {
                const bare = path.slice(1).split("?")[0];
                if (BUILTIN.test(bare)) return { path: bare, external: true };
              }
              let key;
              try {
                key = new URL(path, modules[args.importer].url).href;
              } catch {}
              if (key && Object.hasOwn(modules, key))
                return { path: key, namespace: "npm" };
            } else if (Object.hasOwn(packages, path))
              return { path: packages[path], namespace: "npm" };
            return { errors: [{ text: "Imports are unavailable" }] };
          });
          b.onLoad({ filter: /.*/, namespace: "npm" }, (args) => ({
            contents: modules[args.path].code,
            loader: "js",
          }));
        },
      },
    ],
  });
  const bundle = built.outputFiles[0].text;
  checkImports(bundle);
  return bundle;
}

/** The gate: every import, static or dynamic, must name a built-in literally. */
export function checkImports(bundle) {
  const nodes = [parse(bundle, { ecmaVersion: "latest", sourceType: "module" })];
  while (nodes.length) {
    const node = nodes.pop();
    if (
      node.type === "ImportExpression" ||
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" && node.source)
    ) {
      const source = node.source;
      if (
        !source ||
        source.type !== "Literal" ||
        typeof source.value !== "string" ||
        !BUILTIN.test(source.value)
      )
        throw Error("Imports unavailable");
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value)
          if (child && typeof child === "object") nodes.push(child);
      } else if (value && typeof value === "object") nodes.push(value);
    }
  }
}
