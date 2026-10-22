/** Explicit migration-only archived static compiler. Never used as a runtime fallback. */
import { MAX_PAGE_SOURCE } from "../../../af-contracts.ts";
import { canonicalMediaUrl, mappedSrcset } from "./media.ts";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFragment, serialize } from "parse5";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { convertLegacyJsx } from "../index.ts";
import type {
  CompiledMigrationInput,
  CompiledMigrationOptions,
  CompiledMigrationResult,
  ArchivedStaticOutput,
} from "./contracts.ts";
import {
  MAX_COMPILER_TIME_MS,
  MAX_COMPILED_OUTPUT_BYTES,
  MAX_COMPILED_SOURCE_BYTES,
} from "./contracts.ts";
export type * from "./contracts.ts";
const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const staticKit = new Set(
  "Card CardHeader CardTitle CardDescription CardAction CardContent CardFooter Badge Alert AlertTitle AlertDescription Grid GridItem Markdown Icon Table TableHeader TableBody TableFooter TableRow TableHead TableCell TableCaption Separator Skeleton Progress Button".split(
    " ",
  ),
);
const refused = (code: string, message: string): CompiledMigrationResult => ({
  classification: "manual-blocked",
  html: null,
  identities: {},
  capabilities: [],
  issues: [{ code, message, path: "root" }],
});
function preflight(
  input: CompiledMigrationInput,
): CompiledMigrationResult | null {
  try {
    const core = new URL(input.coreUrl, "https://example.invalid");
    if (
      !["http:", "https:"].includes(core.protocol) ||
      core.pathname !== "/af/v1/core.js" ||
      core.username ||
      core.password ||
      core.search ||
      core.hash
    )
      return refused(
        "compiled-core",
        "Core must be the credential-free platform core URL",
      );
  } catch {
    return refused("compiled-core", "Invalid platform core URL");
  }
  if (Buffer.byteLength(input.source) > MAX_COMPILED_SOURCE_BYTES)
    return refused("compiled-limit", "Source exceeds migration compiler limit");
  const strict = convertLegacyJsx({
    source: input.source,
    coreUrl: input.coreUrl,
  });
  const issue = strict.issues.find((i) => i.code !== "component");
  if (issue) return { ...strict, html: null, classification: "manual-blocked" };
  const root = Parser.extend(jsx()).parseExpressionAt(
    "<>" + input.source + "</>",
    0,
    { ecmaVersion: "latest" },
  ) as any;
  let unsupported: string | null = null;
  const walk = (node: any) => {
    if (node.type === "JSXElement") {
      const name = node.openingElement.name.name;
      if (
        typeof name !== "string" ||
        ["Value", "Query", "Import", "Mutation", "Column", "script"].includes(
          name,
        ) ||
        (/^[A-Z]/.test(name) && name !== "Helmet" && !staticKit.has(name))
      )
        unsupported =
          "Static compiler does not admit data, author scripts or interactive components";
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(root);
  return unsupported ? refused("compiled-capability", unsupported) : null;
}
export async function externalCompile(
  input: CompiledMigrationInput,
  options: CompiledMigrationOptions,
  runnerName = "runner.mts",
): Promise<ArchivedStaticOutput> {
  if (!options.legacyRoot) throw Error("Archived compiler root is required");
  const root = path.resolve(options.legacyRoot);
  const runner = fileURLToPath(new URL(runnerName, import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=1024",
        "--import",
        path.join(root, "node_modules/tsx/dist/loader.mjs"),
        runner,
        root,
        ...(options.fontBundle ? [JSON.stringify(options.fontBundle)] : []),
      ],
      {
        cwd: path.join(root, "services/app"),
        env: {
          PATH: process.env.PATH ?? "",
          NODE_ENV: "development",
          APP__PAGES_HOST: "pages.example.invalid",
          APP__PUBLIC_BASE_URL: "https://example.invalid",
          TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(Error("Archived compiler timed out"));
      },
      Math.min(options.timeoutMs ?? MAX_COMPILER_TIME_MS, MAX_COMPILER_TIME_MS),
    );
    let bytes = 0;
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_COMPILED_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(Error("Archived compiler output exceeds limit"));
      } else chunks.push(chunk);
    });
    // Diagnostics may contain authored material. Never relay raw stderr to callers or logs.
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(Error("Archived static compilation refused"));
        return;
      }
      try {
        resolve(
          JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as ArchivedStaticOutput,
        );
      } catch {
        reject(Error("Invalid archived compiler output"));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
export async function compileArchivedStatic(
  input: CompiledMigrationInput,
  options: CompiledMigrationOptions,
): Promise<CompiledMigrationResult> {
  const blocked = preflight(input);
  if (blocked) return blocked;
  if (
    Object.values(input.resourceMap ?? {}).some(
      (value) => !canonicalMediaUrl(value),
    )
  )
    return refused(
      "compiled-media",
      "Media mapping must use a canonical verified ACL endpoint",
    );
  const mappedMedia = new Set<string>();
  const mappedSets = new Set<string>();
  let compiled: ArchivedStaticOutput;
  try {
    compiled = await (options.compiler?.compile(input) ??
      externalCompile(input, options));
  } catch {
    return refused(
      "compiled-failed",
      "Archived static compiler failed or refused the document",
    );
  }
  if (
    typeof compiled.html !== "string" ||
    typeof compiled.css !== "string" ||
    typeof compiled.title !== "string" ||
    typeof compiled.build !== "string" ||
    Buffer.byteLength(compiled.html + compiled.css) >
      MAX_COMPILED_OUTPUT_BYTES ||
    /<\/style/i.test(compiled.css)
  )
    return refused(
      "compiled-output",
      "Invalid or oversized archived static output",
    );
  const fragment = parseFragment(compiled.html);
  let invalid = false;
  const identities: Record<string, string> = {};
  const visit = (node: any) => {
    if (node.tagName) {
      if (["script", "object", "embed", "iframe"].includes(node.tagName))
        invalid = true;
      node.attrs = node.attrs.filter(
        (a: any) =>
          !["data-mx-ast", "data-hk", "data-mx-source-node-id"].includes(
            a.name,
          ),
      );
      for (const a of node.attrs) {
        if (
          (node.tagName === "img" ||
            (node.tagName === "source" &&
              node.parentNode?.tagName === "picture")) &&
          a.name === "srcset"
        ) {
          const mapped = mappedSrcset(a.value, input.resourceMap ?? {});
          if (mapped) {
            a.value = mapped;
            mappedSets.add(mapped);
          } else invalid = true;
        }
        if (
          node.tagName === "img" &&
          a.name === "src" &&
          Object.hasOwn(input.resourceMap ?? {}, a.value)
        ) {
          a.value = input.resourceMap![a.value];
          mappedMedia.add(a.value);
        }
        if (
          (["src", "srcset", "poster"].includes(a.name) ||
            (node.tagName === "image" &&
              ["href", "xlink:href"].includes(a.name))) &&
          !a.value.startsWith("data:") &&
          !mappedMedia.has(a.value) &&
          !(a.name === "srcset" && mappedSets.has(a.value))
        )
          invalid = true;
        if (
          /^on/i.test(a.name) ||
          a.name === "srcdoc" ||
          (/^data-mx-/.test(a.name) &&
            ![
              "data-mx-inline-story",
              "data-mx-story",
              "data-mx-story-root",
              "data-mx-styled",
            ].includes(a.name))
        )
          invalid = true;
      }
      const id = node.attrs.find((a: any) => a.name === "id")?.value;
      if (id) {
        if (Object.hasOwn(identities, id)) invalid = true;
        identities[id] = id;
        node.attrs = node.attrs.filter((a: any) => a.name !== "data-af-id");
        node.attrs.push({ name: "data-af-id", value: id });
      }
    }
    for (const c of node.childNodes ?? []) visit(c);
  };
  visit(fragment);
  if (invalid)
    return refused(
      "compiled-runtime",
      "Archived output contains unsupported runtime or platform material",
    );
  const attrs = Object.entries(compiled.rootAttributes ?? {})
    .filter(([k]) => k === "class" || k === "data-theme")
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  const html = `<!doctype html><html${attrs}><head><script src="${esc(input.coreUrl)}" data-af="core"></script><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(compiled.title)}</title><style>${compiled.css}</style></head><body>${serialize(fragment)}</body></html>`;
  if (Buffer.byteLength(html) > MAX_PAGE_SOURCE)
    return refused(
      "compiled-page-limit",
      "Compiled HTML exceeds the platform source limit",
    );
  return {
    classification: "renderable",
    html,
    identities,
    issues: [],
    capabilities: ["archived-static-kit", ...compiled.capabilities],
    provenance: {
      compiler: "archived-static",
      build: compiled.build,
      mode: "static-only",
      ...(compiled.fontBundleResourceDigest
        ? { fontBundleResourceDigest: compiled.fontBundleResourceDigest }
        : {}),
      ...(compiled.fontResources?.length
        ? { fontResources: compiled.fontResources }
        : {}),
    },
  };
}
