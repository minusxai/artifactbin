import type { BackendHost, BackendJson } from "../../backend/contracts.ts";
import { assertStorable } from "../../apollo/storable.ts";
import { compileProgramResolver } from "./compiler.ts";
import { programCapabilityHandler } from "./capability.ts";
import type {
  PreparedProgramResolver,
  ProgramBindingManifest,
  ProgramInvocationAuthority,
} from "./runtime-contracts.ts";
/** Offline backend preparation only. Does not persist, register, publish, schedule or activate. */
export async function prepareProgramResolver(
  host: BackendHost,
  script: string,
  manifest: ProgramBindingManifest,
  signal?: AbortSignal,
): Promise<PreparedProgramResolver> {
  const saved = structuredClone(manifest);
  const source = await compileProgramResolver(script, saved);
  const backend = await host.compile(source.source, signal);
  return { backend, manifest: saved, scriptSha256: source.scriptSha256 };
}
/** An internal server adapter. Callers must supply freshly admitted immutable page/version authority. */
export async function invokeProgramResolver(
  host: BackendHost,
  prepared: PreparedProgramResolver,
  invocation: Omit<ProgramInvocationAuthority, "manifest">,
  input: BackendJson,
  signal?: AbortSignal,
): Promise<BackendJson> {
  if (signal?.aborted) throw Error("Program cancelled");
  assertStorable(input);
  const inputJson = JSON.stringify(input);
  if (new TextEncoder().encode(inputJson).length > 8192)
    throw Error("Program JSON exceeds limit");
  await invocation.transport.authorize(signal ?? new AbortController().signal);
  if (signal?.aborted) throw Error("Program cancelled");
  const result = await host.invoke({
    deployment: prepared.backend,
    principal: { ...invocation.principal },
    input: { field: "run", args: { inputJson } },
    env: {},
    reuse: { kind: "one-shot" },
    signal,
    capabilityHandler: programCapabilityHandler({
      ...invocation,
      manifest: prepared.manifest,
    }),
  });
  if (
    typeof result !== "string" ||
    new TextEncoder().encode(result).length > 8192
  )
    throw Error("Invalid program JSON result");
  const output: unknown = JSON.parse(result);
  assertStorable(output);
  return output;
}
