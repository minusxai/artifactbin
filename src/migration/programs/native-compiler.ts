import { createHash } from "node:crypto";
import { parse } from "acorn";
import { compileProgramResolver } from "./compiler.ts";
import type { NativeProgramResolver } from "./native-contracts.ts";
type Node = { type: string; [key: string]: any };
const member = (node: Node, object: string, property: string) =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  !node.optional &&
  node.object?.type === "Identifier" &&
  node.object.name === object &&
  node.property?.type === "Identifier" &&
  node.property.name === property;
/** Reads an explicit tiny grammar; no archived source is evaluated or copied into executable code. */
export async function compileNativeProgramResolver(
  source: string,
): Promise<NativeProgramResolver> {
  if (Buffer.byteLength(source) > 65536)
    throw Error("Native definition exceeds limit");
  const definition = JSON.parse(source);
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition) ||
    Object.keys(definition).some(
      (key) => !["version", "command", "compute"].includes(key),
    ) ||
    definition.version !== 1 ||
    !Array.isArray(definition.command) ||
    definition.command.length !== 3 ||
    definition.command[0] !== "node" ||
    definition.command[1] !== "-e" ||
    typeof definition.command[2] !== "string"
  )
    throw Error("Unsupported native definition");
  const compute = definition.compute;
  if (
    !compute ||
    Object.keys(compute).sort().join() !== "memoryMiB,ttlSeconds,vcpu" ||
    !Number.isFinite(compute.vcpu) ||
    compute.vcpu <= 0 ||
    !Number.isSafeInteger(compute.memoryMiB) ||
    compute.memoryMiB <= 0 ||
    !Number.isSafeInteger(compute.ttlSeconds) ||
    compute.ttlSeconds <= 0
  )
    throw Error("Unsupported native compute");
  const ast = parse(definition.command[2], {
    ecmaVersion: "latest",
    sourceType: "script",
  }) as unknown as Node;
  const body: string[] = [];
  for (const statement of ast.body as Node[]) {
    const call = statement.expression;
    if (
      statement.type !== "ExpressionStatement" ||
      call?.type !== "CallExpression" ||
      call.optional ||
      call.arguments.length !== 1
    )
      throw Error("Native runtime capability required");
    const argument = call.arguments[0];
    if (member(call.callee, "console", "log")) {
      const value =
        argument.type === "Literal" && typeof argument.value === "string"
          ? JSON.stringify(argument.value)
          : member(argument, "process", "env")
            ? undefined
            : argument.type === "MemberExpression" &&
                !argument.computed &&
                !argument.optional &&
                member(argument.object, "process", "env") &&
                argument.property?.type === "Identifier" &&
                argument.property.name === "ARTIFACTBIN_INPUT"
              ? "JSON.stringify(input)"
              : undefined;
      if (value === undefined)
        throw Error("Native runtime capability required");
      body.push(`stdout+=${value}+"\\n";`);
    } else if (
      member(call.callee, "process", "exit") &&
      argument.type === "Literal" &&
      Number.isInteger(argument.value) &&
      argument.value >= 0 &&
      argument.value <= 255
    ) {
      body.push(`return {stdout,stderr:"",exitCode:${argument.value}};`);
    } else throw Error("Native runtime capability required");
  }
  const script = `export default input=>{let stdout="";${body.join("\n")}return {stdout,stderr:"",exitCode:0};}`;
  return {
    kind: "native-receipt-resolver",
    originalSourceSha256: createHash("sha256").update(source).digest("hex"),
    resolver: await compileProgramResolver(
      script,
      {
        values: [],
        queries: [],
        mutations: [],
        defaults: {},
      },
      { outputBytes: 65536 },
    ),
    compute: structuredClone(compute),
    execution: "bounded-straight-line",
    output: "stdout-stderr-exit-code",
    authority: "owner-only",
    concurrency: "no-overlap",
    computeCompatibility: "original-reservation-not-provided",
  };
}
