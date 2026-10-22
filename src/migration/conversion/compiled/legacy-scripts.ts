import { createHash } from "node:crypto";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { externalCompile } from "./index.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import type {
  LegacyScriptMigration,
  LegacyScriptNormalization,
  LegacyScriptNormalizerPort,
} from "./legacy-script-contracts.ts";
export const LEGACY_SCRIPT_CODEMOD_COMMIT =
  "a6938b999515fc2e6ce468b0885080572dd3a9f7";
export const LEGACY_SCRIPT_CODEMOD_SHA256 =
  "e4374e7a1e94f5868846a78dcb6e3f9a5c8cbcd3dd77abfb9fb48beb0f5eb497";
/** Syntax-owned detection: strings, comments and native lowercase iframes are not legacy frames. */
export function hasLegacyManagedFrame(source: string): boolean {
  if (!source.includes("Iframe")) return false;
  try {
    const root = Parser.extend(jsx()).parseExpressionAt(
      "<>" + source + "</>",
      0,
      { ecmaVersion: "latest" },
    );
    const walk = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      if (Array.isArray(value)) return value.some(walk);
      const node = value as Record<string, unknown>;
      if (node.type === "JSXOpeningElement") {
        const name = node.name as { type?: string; name?: string } | undefined;
        if (name?.type === "JSXIdentifier" && name.name === "Iframe")
          return true;
      }
      return Object.values(node).some(walk);
    };
    return walk(root);
  } catch {
    return false;
  }
}
export async function normalizeLegacyManagedFrames(
  source: string,
  port: LegacyScriptNormalizerPort,
): Promise<LegacyScriptNormalization | null> {
  if (
    Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES ||
    !hasLegacyManagedFrame(source)
  )
    return null;
  try {
    const result = await port.migrate(source);
    if (
      !result ||
      !result.changed ||
      typeof result.source !== "string" ||
      result.source === source ||
      Buffer.byteLength(result.source) > MAX_COMPILED_SOURCE_BYTES ||
      !Array.isArray(result.unresolved) ||
      result.unresolved.length ||
      !Array.isArray(result.applied) ||
      !result.applied.length ||
      !result.applied.every((x) => typeof x === "string") ||
      hasLegacyManagedFrame(result.source)
    )
      return null;
    const hash = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    return {
      source: result.source,
      receipt: {
        kind: "original-managed-frame-codemod",
        codemodCommit: LEGACY_SCRIPT_CODEMOD_COMMIT,
        codemodSha256: LEGACY_SCRIPT_CODEMOD_SHA256,
        originalSourceSha256: hash(source),
        derivedSourceSha256: hash(result.source),
        applied: result.applied,
      },
    };
  } catch {
    return null;
  }
}
export function normalizeArchivedManagedFrames(
  source: string,
  legacyRoot: string,
): Promise<LegacyScriptNormalization | null> {
  return normalizeLegacyManagedFrames(source, {
    migrate: (source) =>
      externalCompile<LegacyScriptMigration, { source: string }>(
        { source },
        { legacyRoot },
        "legacy-scripts-runner.mts",
      ),
  });
}
