import { jsonCopy } from "../json.ts";
import type {
  CompileResult,
  SandboxCompilePort,
} from "./compiler-contracts.ts";
import {
  BackendHostError,
  type CompiledBackend,
  type ModuleFetcher,
} from "./contracts.ts";
import { boundedBackendSchema } from "../graphql/execution-policy.ts";
import { sealDeployment } from "./deployment.ts";
import {
  importKind,
  moduleImports,
  pinAdvice,
  resolvePackages,
  type ResolvedPackages,
} from "./packages.ts";
/**
 * Compilation and metadata execution must both happen in the supplied sandbox.
 * The npm packages the file imports are fetched here first (the sandbox has no
 * network) and sent with the source.
 */
export async function compileBackend(
  source: string,
  run: SandboxCompilePort,
  signal?: AbortSignal,
  fetchModule?: ModuleFetcher,
): Promise<CompiledBackend> {
  if (typeof source !== "string" || Buffer.byteLength(source) > 262144)
    throw new BackendHostError("source_quota");
  let specifiers: string[] = [];
  try {
    specifiers = moduleImports(source, true).specifiers;
  } catch {
    // Unreadable source: the sandbox's build refuses it.
  }
  const unpinned = specifiers.find((s) => importKind(s) === "unpinned");
  if (unpinned)
    throw new BackendHostError("build_rejected", pinAdvice(unpinned));
  const wanted = specifiers.filter((s) => importKind(s) === "package");
  let resolved: ResolvedPackages = { packages: {}, modules: {}, lockfile: {} };
  if (wanted.length) {
    if (!fetchModule)
      throw new BackendHostError(
        "build_rejected",
        "npm imports are not available on this server",
      );
    resolved = await resolvePackages(wanted, fetchModule, signal);
  }
  if (signal?.aborted) throw new BackendHostError("cancelled");
  const reply = await run(
    {
      kind: "compile",
      source,
      packages: resolved.packages,
      modules: resolved.modules,
    },
    signal,
  );
  const result = compileResult(reply);
  try {
    const schema = boundedBackendSchema(result.metadata.typeDefs);
    for (const [name, type] of [
      ["Query", schema.getQueryType()],
      ["Mutation", schema.getMutationType()],
    ] as const) {
      if (
        JSON.stringify(Object.keys(type?.getFields() ?? {}).sort()) !==
        JSON.stringify([...result.metadata.roots[name]].sort())
      )
        throw Error();
    }
  } catch {
    throw new BackendHostError("schema_rejected");
  }
  return sealDeployment(source, result.bundle, {
    ...result.metadata,
    runtime: result.runtime,
    lockfile: resolved.lockfile,
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
/** Narrow a process reply without trusting its declared metadata or executing accessors. */
function compileResult(reply: unknown): CompileResult {
  const bundle = record(reply)
    ? Object.getOwnPropertyDescriptor(reply, "bundle")
    : undefined;
  if (!bundle || !("value" in bundle) || typeof bundle.value !== "string")
    throw new BackendHostError("build_rejected");
  try {
    const value = jsonCopy(reply);
    if (
      !record(value) ||
      typeof value.bundle !== "string" ||
      !record(value.metadata)
    )
      throw Error();
    const metadata = value.metadata;
    if (
      typeof metadata.typeDefs !== "string" ||
      !strings(metadata.fields) ||
      !record(metadata.roots) ||
      !strings(metadata.roots.Query) ||
      !strings(metadata.roots.Mutation) ||
      typeof value.runtime !== "string"
    )
      throw Error();
    return {
      bundle: value.bundle,
      metadata: {
        typeDefs: metadata.typeDefs,
        fields: metadata.fields,
        roots: {
          Query: metadata.roots.Query,
          Mutation: metadata.roots.Mutation,
        },
      },
      runtime: value.runtime,
    };
  } catch {
    throw new BackendHostError("schema_rejected");
  }
}
