/** Explicit offline compiler orchestration. Admission owns source capabilities
 * and output safety; this module invokes the compiler and packages the page. */
import { MAX_PAGE_SOURCE } from "../../../af-contracts.ts";
import { prepareAuthorDocument } from "./author-document.ts";
import { admitLocalSource } from "./source-admission.ts";
import { admitLocalOutput } from "./local-output.ts";
import { externalCompile } from "./index.ts";
import type { CompiledMigrationInput } from "./contracts.ts";
import type {
  ArchivedLocalOptions,
  CompiledLocalResult,
} from "./local-contracts.ts";
export type * from "./local-contracts.ts";
const blocked = (code: string): CompiledLocalResult => ({
  classification: "manual-blocked",
  html: null,
  identities: {},
  capabilities: [],
  issues: [
    {
      code,
      message:
        "Local compiled capability requires an explicit migration adapter",
      path: "root",
    },
  ],
});
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
export async function compileArchivedLocal(
  input: CompiledMigrationInput,
  options: ArchivedLocalOptions,
): Promise<CompiledLocalResult> {
  const admittedSource = admitLocalSource(input);
  if (!admittedSource.ok) return blocked(admittedSource.code);
  const plan = admittedSource.plan;
  input = plan.input;
  const {
    author,
    historical,
    backendLinks,
    queryNames: queries,
    datasetNames: imports,
    mutationNames: mutations,
    chartCount,
  } = plan;
  let compiled: unknown;
  try {
    compiled = await (options.compiler?.compile(input) ??
      externalCompile(input, options, "./local-runner.mts"));
  } catch {
    return blocked("compiled-local-failed");
  }
  const admittedOutput = admitLocalOutput(plan, compiled);
  if (!admittedOutput.ok) return blocked(admittedOutput.code);
  const { output, body, state, identities } = admittedOutput.value;
  const attrs = Object.entries(output.rootAttributes)
    .filter(([key]) => ["class", "data-theme"].includes(key))
    .map(([key, value]) => ` ${key}="${esc(value)}"`)
    .join("");
  const links = [...backendLinks]
    .map(
      ([name, href]) =>
        `<link rel="af-backend" href="${esc(href)}" data-af-name="${esc(name)}">`,
    )
    .join("");
  const status = imports.size || historical
    ? historical
      ? '<p role="status" data-migration-dataset-status>Historical data is unavailable. This saved page does not load datasets, evaluate queries, or perform shared data writes.</p>'
      : '<p role="status" data-migration-dataset-status>Loading protected data…</p>'
    : "";
  const authorStatus = author
    ? '<p role="status" data-migration-author-status>Starting page components…</p>'
    : "";
  const html = `<!doctype html><html${attrs}><head><meta charset="utf-8"><script data-af="core" src="${esc(input.coreUrl)}"></script><script type="application/json" data-af="state">${json({ compiledPage: state, ...(author ? { authorSignals: {} } : {}) })}</script>${links}<title>${esc(output.title)}</title><style>${output.css}</style></head><body>${status}${authorStatus}${body}<script type="module">${output.javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  if (Buffer.byteLength(html) > MAX_PAGE_SOURCE)
    return blocked("compiled-page-limit");
  return {
    classification: historical ? "renderable" : "functional",
    html,
    identities,
    issues: [],
    capabilities: [
      "local-scalars",
      ...(input.slideDeck ? ["slide-deck-navigation"] : []),
      "archived-kit",
      "inlined-fonts",
      ...(queries.size && !historical ? ["local-sql-queries"] : []),
      ...(plan.manifest.declarations.some((d) => d.type === "table")
        ? ["local-inline-tables"]
        : []),
      ...(imports.size
        ? [
            historical
              ? "historical-data-unavailable"
              : "protected-dataset-reads",
          ]
        : []),
      ...(author
        ? [
            author.mode === "effects"
              ? "authored-effects"
              : "authored-components",
          ]
        : []),
      ...(chartCount ? ["compiled-charts"] : []),
      ...(mutations.size && !historical
        ? ["registered-dataset-mutations"]
        : []),
    ],
    provenance: {
      compiler: author ? "archived-author" : "archived-local",
      build: output.build,
      mode: historical
        ? "historical-data-unavailable"
        : author
          ? author.mode === "effects"
            ? "authored-effects"
            : "authored-components"
          : "local-scalars",
      modules: output.modules,
    },
  };
}

/** Explicit whole-document author migration. No fallback from another strategy. */
export async function compileArchivedAuthor(
  input: CompiledMigrationInput,
  options: ArchivedLocalOptions,
): Promise<CompiledLocalResult> {
  try {
    const plan = prepareAuthorDocument(input.source);
    return await compileArchivedLocal(
      { ...input, source: plan.source, authorPlan: plan.author },
      options,
    );
  } catch {
    return blocked("compiled-author-capability");
  }
}
