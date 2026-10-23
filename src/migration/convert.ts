import {repairLegacyColumnAliases} from "./conversion/column-alias.ts";
import {normalizeLegacySourceOperations} from "./conversion/source-operations.ts";
import { rewriteLegacyRawMediaSource } from "./raw-media.ts";
import { createHash } from "node:crypto";
import { validateMigrationSourceAdmission } from "./source-admission-policy.ts";
import type { Converter } from "./contracts.ts";
import {
  convertLegacyJsx,
  convertLegacyDocument,
  legacyDocumentSource,
} from "./conversion/index.ts";
import type { MigrationConversionOptions } from "./conversion-strategy-contracts.ts";
/** Prefer retained markup; canonical JSON alone must never become an empty page. */
export const convertMigrationContent: Converter = (input) =>
  input.source.trim()
    ? convertLegacyJsx({ source: input.source, coreUrl: input.coreUrl })
    : input.document !== null && input.document !== undefined
      ? convertLegacyDocument(input.document, { coreUrl: input.coreUrl })
      : {
          classification: "manual-blocked",
          html: null,
          issues: ["Missing source content"],
          identities: {},
        };
/** Explicit strategies, never a hidden retry through a less restrictive compiler. */
export function createMigrationConverter(
  options: MigrationConversionOptions,
): Converter {
  validateMigrationSourceAdmission({
    conversionStrategy: options.strategy,
    sourceAdmission: options.sourceAdmission,
  });
  if (options.strategy === "strict")
    return async (input) => ({
      ...(await convertMigrationContent(input)),
      strategy: "strict",
    });
  if (
    options.strategy !== "archived-static" &&
    options.strategy !== "archived-functional"
  )
    throw new Error("Unknown migration conversion strategy");
  if (!options.legacyRoot && !options.compiler && !options.localCompiler)
    throw new Error(
      "Archived-static conversion requires an explicit archived compiler root",
    );
  return async (input) => {
    let source: string | null;
    let codecFailure: string | undefined;
    let sourceRecovery: import("./contracts.ts").ConversionOutput["sourceRecovery"];
    try {
      source = input.source.trim()
        ? input.source
        : legacyDocumentSource(input.document);
    } catch (error) {
      source = null;
      codecFailure = error instanceof Error ? error.message : undefined;
    }
    if (source === null && options.sourceAdmission === "offline-prototype") {
      const { recoverRetiredSourceWrapper } = await import(
        "./conversion/document-recovery.ts"
      );
      const retired = recoverRetiredSourceWrapper(input.document);
      if (retired) {
        source = retired.source;
        sourceRecovery = {
          kind: "retired-source-wrapper",
          repairedNodes: 0,
          documentSha256: createHash("sha256")
            .update(JSON.stringify(input.document))
            .digest("hex"),
          sourceSha256: createHash("sha256").update(source).digest("hex"),
        };
      }
    }
    if (
      source === null &&
      options.sourceAdmission === "offline-prototype" &&
      options.legacyRoot
    ) {
      const { recoverArchivedDocumentSource } = await import(
        "./conversion/compiled/document-recovery.ts"
      );
      const recovered = await recoverArchivedDocumentSource(
        input.document,
        options.legacyRoot,
      );
      if (recovered) {
        source = recovered.source;
        sourceRecovery = {
          kind: "retained-graph-empty-separators",
          repairedNodes: recovered.repairedNodes,
          documentSha256: createHash("sha256")
            .update(JSON.stringify(input.document))
            .digest("hex"),
          sourceSha256: createHash("sha256").update(source).digest("hex"),
        };
      }
    }
    if (source === null && options.sourceAdmission === "offline-prototype") {
      const { recoverPartialLegacyDocument } = await import(
        "./conversion/document-recovery.ts"
      );
      const partial = recoverPartialLegacyDocument(input.document);
      if (partial) {
        source = partial.source;
        sourceRecovery = {
          kind: "retained-graph-missing-root-content",
          repairedNodes: 0,
          missingNodes: partial.missingNodes,
          documentSha256: createHash("sha256")
            .update(JSON.stringify(input.document))
            .digest("hex"),
          sourceSha256: createHash("sha256").update(source).digest("hex"),
        };
      }
    }
    let sourceCompatibility: import("./contracts.ts").ConversionOutput["sourceCompatibility"];
    if(source!==null && options.sourceAdmission==='offline-prototype') {
      const repaired=repairLegacyColumnAliases(source,input.datasetBindings??[],options.legacyColumnAliasAdmissions);
      source=repaired.source;sourceCompatibility=repaired.receipts.length?repaired.receipts:undefined;
      try { source=normalizeLegacySourceOperations(source,(input.datasetBindings??[]).map(b=>b.legacyRef),options.legacyDuckSqlAdmissions).source; }
      catch { /* Unsupported source syntax remains an explicit converter refusal. */ }
    }
    let sourceNormalization: import("./contracts.ts").ConversionOutput["sourceNormalization"];
    if (
      source !== null &&
      options.strategy === "archived-functional" &&
      options.sourceAdmission === "offline-prototype" &&
      options.legacyRoot
    ) {
      const { normalizeArchivedManagedFrames } = await import(
        "./conversion/compiled/legacy-scripts.ts"
      );
      const normalized = await normalizeArchivedManagedFrames(
        source,
        options.legacyRoot,
      );
      if (normalized) {
        source = normalized.source;
        sourceNormalization = normalized.receipt;
      }
    }
    const finish = (
      output: import("./contracts.ts").ConversionOutput,
    ): import("./contracts.ts").ConversionOutput => ({
      ...output,
      ...(sourceNormalization ? { sourceNormalization } : {}),
      ...(sourceCompatibility ? { sourceCompatibility } : {}),
      ...(sourceRecovery ? { sourceRecovery } : {}),
      ...(sourceRecovery?.kind === "retained-graph-missing-root-content" &&
      output.html
        ? {
            classification: "renderable" as const,
            issues: [
              ...output.issues,
              {
                code: "document-partial-recovery",
                message:
                  "Original saved content unavailable at retained root positions",
                missingNodes: sourceRecovery.missingNodes,
              },
            ],
          }
        : {}),
    });
    if (source === null)
      return {
        classification: "manual-blocked",
        html: null,
        issues: [
          {
            code: "document-codec",
            message:
              codecFailure ?? "Archived document cannot be reconstructed",
          },
        ],
        identities: {},
        strategy: options.strategy,
      };
    const { compileArchivedStatic } = await import(
      "./conversion/compiled/index.ts"
    );
    const meta = input.meta ?? {};
    let compiledSource: string;
    try {
      compiledSource = rewriteLegacyRawMediaSource(
        source,
        input.resourceMap ?? {},
      ).source;
    } catch {
      return finish({
        classification: "manual-blocked",
        html: null,
        issues: ["Invalid verified media mapping"],
        identities: {},
        strategy: options.strategy,
      });
    }
    const compiledInput = {
      source: compiledSource,
      coreUrl: input.coreUrl,
      resourceMap: input.resourceMap,
      datasetBindings: input.datasetBindings,
      sourceQueries: input.sourceQueries,
      datasetMutations: input.datasetMutations,
      boundValueColumns: input.boundValueColumns,
      membersBinding: input.membersBinding,
      viewerBinding: input.viewerBinding,
      personBindings: input.personBindings,
      cellUserChoiceBindings: input.cellUserChoiceBindings,
      datasetAttachments: input.datasetAttachments,
      datasetUnavailable: input.datasetUnavailable,
      theme: typeof meta.theme === "string" ? meta.theme : null,
      template: typeof meta.template === "string" ? meta.template : null,
      colorMode:
        meta.colorMode === "dark" ? ("dark" as const) : ("light" as const),
    };
    const compilerOptions = {
      legacyRoot: options.legacyRoot,
      fontBundle: options.fontBundle,
    };
    const result = await compileArchivedStatic(compiledInput, {
      ...compilerOptions,
      compiler: options.compiler,
    });
    if (
      options.strategy === "archived-static" ||
      result.classification !== "manual-blocked"
    )
      return finish({ ...result, strategy: options.strategy });
    const { compileArchivedLocal, compileArchivedAuthor } = await import(
      "./conversion/compiled/local.ts"
    );
    const local = await compileArchivedLocal(compiledInput, {
      ...compilerOptions,
      compiler: options.localCompiler,
      sourceAdmission: options.sourceAdmission,
    });
    if (local.classification !== "manual-blocked")
      return finish({ ...local, strategy: options.strategy });
    const authored = await compileArchivedAuthor(compiledInput, {
      ...compilerOptions,
      compiler: options.localCompiler,
      sourceAdmission: options.sourceAdmission,
    });
    if (authored.classification !== "manual-blocked")
      return finish({ ...authored, strategy: options.strategy });
    const routeIssues = (route: string, issues: readonly unknown[]) =>
      issues.map((issue) =>
        issue && typeof issue === "object"
          ? { ...issue, route }
          : { issue, route },
      );
    return {
      ...local,
      ...(sourceNormalization ? { sourceNormalization } : {}),
      ...(sourceCompatibility ? { sourceCompatibility } : {}),
      ...(sourceRecovery ? { sourceRecovery } : {}),
      strategy: options.strategy,
      issues: [
        ...routeIssues("archived-static", result.issues),
        ...routeIssues("archived-local", local.issues),
        ...routeIssues("archived-author", authored.issues),
      ],
    };
  };
}
