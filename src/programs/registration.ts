import { createHash } from "node:crypto";
import type { SavedQueryRegistration } from "../persistence/dataset-queries-contracts.ts";
/** Pure metadata/source integrity check. Offline compilation never evaluates author code. */
export function assertSavedProgramRegistration(
  registration: SavedQueryRegistration,
): void {
  const program = registration.program;
  if (!program) return;
  const { resolver, manifest } = program;
  if (program.native) {
    const n = program.native;
    if (
      !/^[a-f0-9]{64}$/.test(n.originalSourceSha256) ||
      n.authority !== "owner-only" ||
      n.concurrency !== "no-overlap" ||
      n.computeCompatibility !== "original-reservation-not-provided" ||
      !n.compute ||
      !Number.isFinite(n.compute.vcpu) ||
      n.compute.vcpu <= 0 ||
      !Number.isSafeInteger(n.compute.memoryMiB) ||
      n.compute.memoryMiB <= 0 ||
      !Number.isSafeInteger(n.compute.ttlSeconds) ||
      n.compute.ttlSeconds <= 0 ||
      manifest.values.length ||
      manifest.queries.length ||
      manifest.mutations.length
    )
      throw Error("Native program registration invalid");
  }
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length &&
    new Set(a).size === a.length &&
    a.every((name) => b.includes(name));
  if (
    !resolver ||
    !manifest ||
    (resolver.outputBytes !== undefined &&
      (resolver.outputBytes !== 65536 || !program.native)) ||
    typeof resolver.source !== "string" ||
    Buffer.byteLength(resolver.source) > 262144 ||
    createHash("sha256").update(resolver.source).digest("hex") !==
      resolver.sourceSha256 ||
    resolver.scriptSha256 !== registration.moduleSourceSha256 ||
    resolver.operation !== "Mutation.run" ||
    resolver.reuse !== "one-shot" ||
    resolver.activation !== "not-activated" ||
    !same(manifest.values, Object.keys(registration.plan.scalars)) ||
    !same(
      manifest.queries,
      registration.plan.queries.map((query) => query.name),
    ) ||
    !same(Object.keys(manifest.defaults), manifest.values) ||
    manifest.values.some(
      (name) =>
        !Object.is(
          manifest.defaults[name],
          registration.plan.scalars[name]!.default,
        ),
    ) ||
    !Array.isArray(manifest.mutations) ||
    new Set(manifest.mutations).size !== manifest.mutations.length ||
    manifest.mutations.some(
      (name) => !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name),
    ) ||
    Object.entries(manifest.resets ?? {}).some(
      ([name, fields]) =>
        !manifest.mutations.includes(name) ||
        !Array.isArray(fields) ||
        fields.some((field) => !manifest.values.includes(field)),
    )
  )
    throw Error("Program registration invalid");
}
