import type { BackendHost, BackendJson } from "../../backend/contracts.ts";
import { assertStorable } from "../../apollo/storable.ts";
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
  const { compileProgramResolver } = await import("./compiler.ts");
  const source = await compileProgramResolver(script, saved);
  const backend = await host.compile(source.source, signal);
  return { backend, manifest: saved, scriptSha256: source.scriptSha256 };
}
export { invokeProgramResolver } from "../../programs/service.ts";
