/** Architectural roles, not a snapshot of today's individual import edges. */
export type ModuleRole = "pure" | "adapter" | "credential" | "server";
export interface ImportEdge {
  target: string;
  typeOnly: boolean;
}
export interface SourceModule {
  id: string;
  imports: ImportEdge[];
  ambientEffects: string[];
  opaqueLoads: number;
}
export interface BoundaryPolicy {
  role(id: string): ModuleRole;
  appEntries: readonly string[];
  purePackages: readonly string[];
  /** Host adapters may be embedded locally, but never shipped in an isolated app runner. */
  hostOnly?(id: string): boolean;
  isolatedEntry?(id: string): boolean;
  /** Offline tooling must never enter the deployed product graph. */
  offlineOnly?(id: string): boolean;
}
export interface BoundaryViolation {
  rule:
    | "offline-dependency"
    | "pure-dependency"
    | "pure-effect"
    | "app-authority"
    | "cycle"
    | "opaque-load"
    | "unresolved-import";
  path: string[];
  message: string;
}
/** The relevant esbuild metafile surface; checker does not depend on the bundler implementation. */
export interface BundleInputs {
  inputs: Record<
    string,
    { imports: readonly { path: string; external?: boolean }[] }
  >;
}

import ts from "typescript";
import { builtinModules } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { posix, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const normalize = (id: string) => posix.normalize(id.replaceAll("\\", "/"));
const nodePackages = new Set(
  builtinModules.map((id) => id.replace(/^node:/, "")),
);
const isNode = (id: string) => id.startsWith("node:") || nodePackages.has(id);
const packageMatch = (id: string, allowed: readonly string[]) =>
  allowed.some((name) => id === name || id.startsWith(name + "/"));
const serverPackages = [
  "pg",
  "ws",
  "esbuild",
  "isolated-vm",
  "workerd",
  "dockerode",
];
const serverDependency = (id: string) => {
  const packagePath = id.includes("node_modules/")
    ? id.slice(id.lastIndexOf("node_modules/") + "node_modules/".length)
    : id;
  return isNode(id) || packageMatch(packagePath, serverPackages);
};
const ambient = new Set([
  "process",
  "Buffer",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
]);

export const productPolicy: BoundaryPolicy = {
  offlineOnly: (id) => /^src\/migration\//.test(id) || /^(?:.*node_modules\/)?acorn-jsx(?:\/|$)/.test(id),
  hostOnly: (id) => /^src\/browser\/(?:connection-coordinator|backend-connection|collaboration-transport)\.ts$/.test(id),
  isolatedEntry: (id) => /^src\/browser\/(?:runner|bridge)\.[jt]s$/.test(id),
  role(id) {
    if (id === "src/server/document-authorization.ts" || id === "src/backend/container/env-policy.mjs") return "pure";
    if (/(?:^|\/)api-check\.ts$/.test(id)) return "adapter";
    if (/(?:^|\/)(?:contracts|[\w-]+-contracts)\.[cm]?[jt]s$/.test(id))
      return "pure";
    if (
      /^src\/browser\/(?:platform-frame|credential-frame|trusted-connection|pairing-exchange)\.[jt]s$/.test(
        id,
      ) ||
      /^src\/credentials\//.test(id)
    )
      return "credential";
    if (
      /^src\/(?:backend|server|persistence|connectors)\//.test(id) ||
      /^src\/(?:server|database|library|files|config|live|document)\.[jt]s$/.test(
        id,
      )
    )
      return "server";
    if (/^src\/browser\/(?:lifecycle|activity|document-host|viewer-roster|document-view|comment-command|comment-composer|platform-status)\.[jt]s$/.test(id)) return "pure";
    if (
      /^src\/(?:domain|app-state|graphql|page|apollo|ids)\//.test(id) ||
      /^src\/(?:json|errors|model|model-values|comment-model|publication-model|group-authority|principal-policy|access|email|path-model|chrome-model|durability|file-browser|navigation)\.[jt]s$/.test(
        id,
      )
    )
      return "pure";
    return "adapter";
  },
  appEntries: [
    "runtime",
    "runner",
    "bridge",
    "local-runtime",
    "localruntime",
    "core/core",
  ].flatMap((name) => ["js", "ts"].map((ext) => `src/browser/${name}.${ext}`)),
  purePackages: ["parse5", "css-tree", "acorn", "graphql"],
};

/** Parse both JS and TS. Symbol binding distinguishes injected ports from ambient I/O. */
export function inspectSources(
  input: Readonly<Record<string, string>>,
): SourceModule[] {
  const sources = new Map(
    Object.entries(input).map(([id, code]) => [normalize(id), code]),
  );
  const prefix = "/__pagegi_boundary__/";
  const host = ts.createCompilerHost({});
  host.getSourceFile = (name, languageVersion) => {
    const code = sources.get(normalize(name).replace(prefix, ""));
    return code === undefined
      ? undefined
      : ts.createSourceFile(name, code, languageVersion, true);
  };
  host.fileExists = (name) => sources.has(normalize(name).replace(prefix, ""));
  host.readFile = (name) => sources.get(normalize(name).replace(prefix, ""));
  const program = ts.createProgram(
    [...sources.keys()].map((id) => prefix + id),
    {
      allowJs: true,
      noLib: true,
      noResolve: true,
      target: ts.ScriptTarget.ES2022,
    },
    host,
  );
  const checker = program.getTypeChecker();
  function target(id: string, specifier: string) {
    // The isolated compiler supplies this guest module at deployment time.
    // It remains privileged; no other importer gets an unresolved-import exemption.
    if (
      id === "src/backend/container/entry.mjs" &&
      specifier === "./backend.js"
    )
      return "src/backend/container/backend.js";
    if (!specifier.startsWith(".") && !specifier.startsWith("/"))
      return specifier;
    const base = specifier.startsWith("/")
      ? "src/" + specifier.slice(1)
      : posix.join(posix.dirname(id), specifier);
    const stem = base.replace(/\.[cm]?[jt]sx?$/, "");
    const candidates = [
      base,
      stem + ".ts",
      stem + ".js",
      base + ".ts",
      base + ".js",
      base + "/index.ts",
      base + "/index.js",
    ];
    // Legacy HTTP-served browser asset aliases. These are composition routes, not pure imports.
    if (specifier.startsWith("/"))
      candidates.push("src/browser/" + specifier.slice(1));
    return (
      candidates.find((candidate) => sources.has(candidate)) ??
      "unresolved:" + base
    );
  }
  return [...sources.keys()].sort().map((id) => {
    const source = program.getSourceFile(prefix + id)!;
    const result: SourceModule = {
      id,
      imports: [],
      ambientEffects: [],
      opaqueLoads: 0,
    };
    const effects = new Set<string>();
    function edge(value: ts.Node | undefined, typeOnly: boolean) {
      if (value && ts.isStringLiteralLike(value))
        result.imports.push({ target: target(id, value.text), typeOnly });
      else result.opaqueLoads++;
    }
    function local(identifier: ts.Identifier) {
      const symbol = ts.isShorthandPropertyAssignment(identifier.parent)
        ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
        : checker.getSymbolAtLocation(identifier);
      return (
        symbol?.declarations?.some((d) => d.getSourceFile() === source) ?? false
      );
    }
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const names = clause?.namedBindings;
        const only =
          !!clause?.isTypeOnly ||
          (!!clause &&
            !clause.name &&
            !!names &&
            ts.isNamedImports(names) &&
            names.elements.length > 0 &&
            names.elements.every((e) => e.isTypeOnly));
        edge(node.moduleSpecifier, only);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const names = node.exportClause;
        edge(
          node.moduleSpecifier,
          node.isTypeOnly ||
            (!!names &&
              ts.isNamedExports(names) &&
              names.elements.length > 0 &&
              names.elements.every((e) => e.isTypeOnly)),
        );
      } else if (ts.isImportTypeNode(node)) {
        edge(
          ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : undefined,
          true,
        );
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        edge(node.moduleReference.expression, node.isTypeOnly);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require" &&
            !local(node.expression)))
      ) {
        edge(node.arguments[0], false);
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "globalThis" &&
        ambient.has(node.name.text) &&
        !local(node.expression)
      )
        effects.add(node.name.text);
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        !local(node.expression)
      ) {
        const name = `${node.expression.text}.${node.name.text}`;
        if (
          [
            "Date.now",
            "Math.random",
            "crypto.randomUUID",
            "crypto.getRandomValues",
          ].includes(name)
        )
          effects.add(name);
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Date" &&
        !local(node.expression) &&
        !node.arguments?.length
      )
        effects.add("new Date()");
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "globalThis" &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        ambient.has(node.argumentExpression.text) &&
        !local(node.expression)
      )
        effects.add(node.argumentExpression.text);
      if (ts.isIdentifier(node) && ambient.has(node.text) && !local(node)) {
        const parent = node.parent;
        const propertyName =
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          ((ts.isPropertyAssignment(parent) ||
            ts.isPropertySignature(parent) ||
            ts.isMethodDeclaration(parent)) &&
            parent.name === node);
        if (!propertyName) effects.add(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    result.ambientEffects = [...effects].sort();
    return result;
  });
}

/** Enforce policy on graph roles; adding/reorganizing a valid module needs no edge snapshot update. */
export function checkBoundaries(
  modules: readonly SourceModule[],
  policy: BoundaryPolicy = productPolicy,
): BoundaryViolation[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const violations: BoundaryViolation[] = [];
  const add = (
    rule: BoundaryViolation["rule"],
    path: string[],
    detail: string,
  ) =>
    violations.push({
      rule,
      path,
      message: `${rule}: ${path.join(" → ")} (${detail})`,
    });
  for (const module of modules) {
    if (!policy.offlineOnly?.(module.id))
      for (const edge of module.imports)
        if (policy.offlineOnly?.(edge.target))
          add("offline-dependency", [module.id, edge.target], "offline migration tooling cannot enter product code");
    for (const edge of module.imports)
      if (edge.target.startsWith("unresolved:"))
        add(
          "unresolved-import",
          [module.id, edge.target],
          "local dependency cannot be classified",
        );
    if (policy.role(module.id) === "pure") {
      for (const effect of module.ambientEffects)
        add(
          "pure-effect",
          [module.id, effect],
          "inject an effect port instead of ambient I/O",
        );
      if (module.opaqueLoads)
        add(
          "opaque-load",
          [module.id],
          "pure module has a nonliteral dependency",
        );
      for (const edge of module.imports) {
        const allowed = byId.has(edge.target)
          ? policy.role(edge.target) === "pure"
          : !isNode(edge.target) &&
            packageMatch(edge.target, policy.purePackages);
        if (!allowed)
          add(
            "pure-dependency",
            [module.id, edge.target],
            "pure policy may depend only on pure policy or approved pure libraries",
          );
      }
    }
  }
  for (const entry of policy.appEntries) {
    if (!byId.has(entry)) continue;
    const seen = new Set<string>();
    function walk(id: string, path: string[]) {
      if (seen.has(id)) return;
      seen.add(id);
      if (serverDependency(id))
        add(
          "app-authority",
          path,
          "server capability in untrusted app closure",
        );
      const module = byId.get(id);
      if (!module) return;
      if (["credential", "server"].includes(policy.role(id)) ||
          (policy.isolatedEntry?.(entry) && policy.hostOnly?.(id)))
        add(
          "app-authority",
          path,
          "trusted implementation in untrusted app closure",
        );
      if (module.opaqueLoads)
        add(
          "opaque-load",
          path,
          "untrusted bundle dependency must be statically classifiable",
        );
      for (const edge of module.imports)
        if (!edge.typeOnly) walk(edge.target, [...path, edge.target]);
    }
    walk(entry, [entry]);
  }
  // Reject runtime cycles; erased type-only references do not create initialization cycles.
  const visited = new Set<string>(),
    active = new Set<string>();
  function cycles(id: string, path: string[]) {
    if (active.has(id)) {
      add(
        "cycle",
        [...path.slice(path.indexOf(id)), id],
        "runtime dependency cycle",
      );
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const edge of byId.get(id)?.imports ?? [])
      if (!edge.typeOnly && byId.has(edge.target))
        cycles(edge.target, [...path, id]);
    active.delete(id);
  }
  for (const module of modules) cycles(module.id, []);
  return violations;
}

/** Check actual resolved bundler inputs, including transitive package code and external imports.
 * Pass repository-relative esbuild paths. Unrelated trusted outputs are not traversed.
 */
export function checkBuiltApp(
  metafile: BundleInputs,
  entry: string,
  policy: BoundaryPolicy = productPolicy,
): BoundaryViolation[] {
  const inputs = new Map(
    Object.entries(metafile.inputs).map(([id, value]) => [
      normalize(id),
      value,
    ]),
  );
  entry = normalize(entry);
  if (!inputs.has(entry))
    throw Error(`Missing app entry in build graph: ${entry}`);
  const violations: BoundaryViolation[] = [],
    seen = new Set<string>();
  function walk(id: string, path: string[]) {
    if (seen.has(id)) return;
    seen.add(id);
    if (policy.offlineOnly?.(id))
      violations.push({ rule: "offline-dependency", path,
        message: `offline-dependency: ${path.join(" → ")} (offline tooling in emitted product closure)` });
    if (
      serverDependency(id) ||
      ["credential", "server"].includes(policy.role(id)) ||
      (policy.isolatedEntry?.(entry) && policy.hostOnly?.(id))
    )
      violations.push({
        rule: "app-authority",
        path,
        message: `app-authority: ${path.join(" → ")} (trusted capability in emitted app closure)`,
      });
    for (const edge of inputs.get(id)?.imports ?? []) {
      const target = normalize(edge.path);
      walk(target, [...path, target]);
    }
  }
  walk(entry, [entry]);
  return violations;
}

export async function readSources(
  root: string,
): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (
        /\.[cm]?[jt]s$/.test(entry.name) &&
        !/\.d\.[cm]?ts$/.test(entry.name)
      )
        sources[normalize(relative(root, path))] = await readFile(path, "utf8");
    }
  }
  await walk(resolve(root, "src"));
  return sources;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const sources = await readSources(process.cwd());
  const violations = checkBoundaries(inspectSources(sources));
  for (const violation of violations) console.error(violation.message);
  if (violations.length) process.exitCode = 1;
  else
    console.log(
      `Architectural boundaries passed for ${Object.keys(sources).length} source modules.`,
    );
}
