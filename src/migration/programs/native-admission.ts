import { createHash } from "node:crypto";
import { parse } from "acorn";
import { compileNativeProgramResolver } from "./native-compiler.ts";
import type {
  NativeProgramAdmission,
  NativeProgramExclusionDecision,
  NativeProgramExclusion,
} from "./native-contracts.ts";
/** Exact archived UTF8 bytes: JSON reserialization is deliberately not used. */
export const nativeProgramSourceSha256 = (source: string) =>
  createHash("sha256").update(source).digest("hex");
export function validateNativeProgramExclusions(
  decisions: readonly NativeProgramExclusionDecision[] = [],
): void {
  if (!Array.isArray(decisions))
    throw Error("Invalid native program exclusion decisions");
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (
      !decision ||
      Object.keys(decision).some(
        (key) => !["sourceSha256", "decision"].includes(key),
      ) ||
      !/^[a-f0-9]{64}$/.test(decision.sourceSha256) ||
      decision.decision !== "remote-agent-runtime-not-migrated" ||
      seen.has(decision.sourceSha256)
    )
      throw Error("Invalid native program exclusion decision");
    seen.add(decision.sourceSha256);
  }
}
/** Offline AST/metadata admission only. Unknown pure syntax is never labeled a remote agent. */
export async function admitNativeProgram(
  source: string,
): Promise<NativeProgramAdmission> {
  const sourceSha256 = nativeProgramSourceSha256(source);
  let definition: any, ast: any;
  try {
    if (Buffer.byteLength(source) > 65536) throw Error();
    definition = JSON.parse(source);
    if (
      !definition ||
      typeof definition !== "object" ||
      Array.isArray(definition) ||
      Object.keys(definition).some(
        (key) => !["version", "command", "compute", "env"].includes(key),
      ) ||
      definition.version !== 1 ||
      !Array.isArray(definition.command) ||
      !definition.command.length ||
      definition.command.length > 128 ||
      !definition.command.every(
        (v: unknown) =>
          typeof v === "string" &&
          v.length > 0 &&
          v.length <= 8192 &&
          !v.includes("\0"),
      )
    )
      throw Error();
    if (definition.compute !== undefined) {
      const c = definition.compute;
      if (
        !c ||
        typeof c !== "object" ||
        Array.isArray(c) ||
        Object.keys(c).some(
          (key) =>
            !["vcpu", "memoryMiB", "ttlSeconds", "idleSeconds"].includes(key),
        ) ||
        !Number.isFinite(c.vcpu) ||
        c.vcpu < 0.25 ||
        c.vcpu > 16 ||
        !Number.isInteger(c.memoryMiB) ||
        c.memoryMiB < 128 ||
        c.memoryMiB > 32768 ||
        !Number.isInteger(c.ttlSeconds) ||
        c.ttlSeconds < 10 ||
        c.ttlSeconds > 86400 ||
        (c.idleSeconds !== undefined &&
          (!Number.isInteger(c.idleSeconds) ||
            c.idleSeconds < 1 ||
            c.idleSeconds > c.ttlSeconds))
      )
        throw Error();
    }
    if (definition.env !== undefined) {
      if (
        !definition.env ||
        typeof definition.env !== "object" ||
        Array.isArray(definition.env) ||
        Object.keys(definition.env).length > 127
      )
        throw Error();
      for (const [key, value] of Object.entries(definition.env))
        if (
          !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(key) ||
          typeof value !== "string" ||
          value.length > 8192 ||
          value.includes("\0") ||
          /^(AF_|ARTIFACTBIN_|MODAL_|AWS_|GOOGLE_|CONTRACT__|LD_|XDG_|NODE_OPTIONS$|BASH_ENV$|ENV$|HOME$|PATH$|SHELL$|USER$|LOGNAME$)/.test(
            key,
          ) ||
          /(?:API_KEY|(?:^|_)TOKEN|ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|BEARER_TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)$/i.test(
            key,
          )
        )
          throw Error();
    }
    if (
      definition.command.length !== 3 ||
      definition.command[0] !== "node" ||
      definition.command[1] !== "-e"
    )
      return {
        kind: "remote-runtime-required",
        sourceSha256,
        capabilities: ["native-command"],
      };
    ast = parse(definition.command[2], {
      ecmaVersion: "latest",
      sourceType: "script",
    });
  } catch {
    return { kind: "invalid-source", sourceSha256 };
  }
  const capabilities = new Set<string>();
  if (definition.env !== undefined) capabilities.add("native-environment");
  const visit = (value: any, parent?: any) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, parent));
      return;
    }
    if (value.type === "ImportExpression") capabilities.add("native-module");
    if (
      value.type === "CallExpression" &&
      value.callee?.type === "Identifier"
    ) {
      if (value.callee.name === "require") capabilities.add("native-module");
      if (["setTimeout", "setInterval"].includes(value.callee.name))
        capabilities.add("native-timer");
    }
    if (
      value.type === "MemberExpression" &&
      value.object?.type === "Identifier" &&
      value.object.name === "process"
    ) {
      const property = value.computed
        ? value.property?.value
        : value.property?.name;
      if (property === "env") {
        if (
          parent?.type !== "MemberExpression" ||
          parent.object !== value ||
          parent.computed ||
          parent.property?.name !== "ARTIFACTBIN_INPUT"
        )
          capabilities.add("native-environment");
      } else if (property !== "exit") capabilities.add("native-process");
    }
    for (const [key, child] of Object.entries(value))
      if (!["start", "end", "loc"].includes(key)) visit(child, value);
  };
  visit(ast);
  if (capabilities.size)
    return {
      kind: "remote-runtime-required",
      sourceSha256,
      capabilities: [...capabilities].sort(),
    };
  try {
    return {
      kind: "resolver-compatible",
      sourceSha256,
      program: await compileNativeProgramResolver(source),
    };
  } catch {
    return { kind: "unsupported-source", sourceSha256 };
  }
}
export async function nativeProgramExclusion(
  source: string,
  decisions: readonly NativeProgramExclusionDecision[] = [],
): Promise<NativeProgramExclusion | undefined> {
  validateNativeProgramExclusions(decisions);
  const sourceSha256 = nativeProgramSourceSha256(source);
  const decision = decisions.find((d) => d.sourceSha256 === sourceSha256);
  if (!decision) return undefined;
  const admission = await admitNativeProgram(source);
  if (admission.kind !== "remote-runtime-required")
    throw Error("Native exclusion does not identify a remote runtime program");
  return {
    format: "program",
    sourceSha256,
    decision: decision.decision,
    reason: "remote-runtime-required",
  };
}
