import { createHash } from "node:crypto";
import { canonicalMigrationValue } from "../verification-values.ts";
import type { RetainedJsxNode } from "./analyze-contracts.ts";
import type {
  NativeOperationAnalysisInput,
  NativeOperationCoverage,
  NativeOperationProof,
  NativeOperationGuarantee,
  NativeOperationReads,
  NativeOperationRoute,
} from "./operations-contracts.ts";

const digest = (value: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(value)).digest("hex");
const validDigest = (value: string) => /^[a-f0-9]{64}$/.test(value);
const attr = (node: RetainedJsxNode, name: string) =>
  node.type === "element"
    ? node.attributes.find((a) => a.name === name)?.value
    : undefined;
const literal = (node: RetainedJsxNode, name: string) => {
  const value = attr(node, name);
  return value?.static ? value.json : undefined;
};
function elements(nodes: readonly RetainedJsxNode[]): RetainedJsxNode[] {
  return nodes.flatMap((node) =>
    node.type === "element" ? [node, ...elements(node.children)] : [],
  );
}

/** Pure preparation evidence. No SQL execution, registration, destination write, or native runtime is produced. */
export function analyzeNativeOperations(
  input: NativeOperationAnalysisInput,
): NativeOperationCoverage {
  const { analysis, compilation, historical } = input;
  if (
    !validDigest(analysis.sourceSha256) ||
    !validDigest(analysis.compilerSourceSha256) ||
    compilation.sourceSha256 !== analysis.sourceSha256 ||
    compilation.compilerSourceSha256 !== analysis.compilerSourceSha256 ||
    !validDigest(input.sqlEngineSha256) ||
    compilation.sqlEngineSha256 !== input.sqlEngineSha256
  )
    throw Error("operation_compiler_identity_mismatch");
  const blockers: NativeOperationCoverage["blockers"][number][] = [],
    operations: NativeOperationProof[] = [];
  const nodes = elements(analysis.nodes),
    queries = new Map(compilation.queries.map((q) => [q.name, q]));
  const block = (code: string, name: string, node: string) =>
    blockers.push({ code, operation: name, sourceNode: node });
  const source = (kind: "query" | "mutation", name: string) => {
    const matches = nodes.filter(
      (node) =>
        node.type === "element" &&
        node.tag === (kind === "query" ? "Query" : "Mutation") &&
        literal(node, "name") === name,
    );
    if (matches.length !== 1) {
      block("operation-source-node-missing", name, "");
      return "";
    }
    return matches[0]!.graphKey;
  };
  for (const [kind, decls, compiled] of [
    ["query", analysis.flow.queries, compilation.queries],
    ["mutation", analysis.flow.mutations, compilation.mutations],
  ] as const) {
    for (const decl of decls)
      if (!compiled.some((c) => c.name === decl.name))
        block("compiled-operation-missing", decl.name, source(kind, decl.name));
    if (new Set(compiled.map((c) => c.name)).size !== compiled.length)
      block("compiled-operation-duplicate", kind, "");
    for (const op of compiled)
      if (!decls.some((d) => d.name === op.name))
        block("compiled-operation-undeclared", op.name, source(kind, op.name));
  }
  const order: string[] = [],
    active = new Set<string>(),
    visited = new Set<string>();
  function visit(name: string): void {
    if (active.has(name)) {
      block("query-dependency-cycle", name, source("query", name));
      return;
    }
    if (visited.has(name)) return;
    const query = queries.get(name);
    if (!query) {
      block("query-dependency-missing", name, "");
      return;
    }
    active.add(name);
    for (const dependency of query.reads.queries) {
      if (!queries.has(dependency))
        block("query-dependency-missing", name, source("query", name));
      else visit(dependency);
    }
    active.delete(name);
    visited.add(name);
    order.push(name);
  }
  for (const query of compilation.queries) visit(query.name);
  function add(
    kind: NativeOperationProof["kind"],
    name: string,
    sourceNode: string,
    body: unknown,
    reads: NativeOperationReads,
    route: NativeOperationRoute,
    requiredGuarantees: NativeOperationGuarantee[],
  ): void {
    const operationSha256 = digest({
      key: analysis.key,
      sourceSha256: analysis.sourceSha256,
      compilerSourceSha256: analysis.compilerSourceSha256,
      sqlEngineSha256: input.sqlEngineSha256,
      kind,
      name,
      body,
      values: compilation.values,
      imports: compilation.imports,
    });
    const proof: NativeOperationProof = {
      kind,
      name,
      sourceNode,
      operationSha256,
      route,
      dependencies: [...reads.queries],
      requiredGuarantees,
      status: "blocked",
    };
    operations.push(proof);
    for (const value of reads.values)
      if (!compilation.values.some((v) => v.name === value))
        block("value-dependency-missing", name, sourceNode);
    const candidates = (input.admissions ?? []).filter(
      (a) => a.kind === kind && a.name === name,
    );
    if (candidates.length !== 1) {
      block(
        candidates.length
          ? "operation-registration-ambiguous"
          : "operation-registration-missing",
        name,
        sourceNode,
      );
      return;
    }
    const admission = candidates[0]!;
    if (
      admission.operationSha256 !== operationSha256 ||
      admission.route !== route ||
      !validDigest(admission.planSha256)
    ) {
      block("operation-registration-mismatch", name, sourceNode);
      return;
    }
    for (const guarantee of requiredGuarantees)
      if (!admission.guarantees.includes(guarantee))
        block(`guarantee-${guarantee}-missing`, name, sourceNode);
    const imports = [...new Set(reads.imports)];
    for (const bindingName of imports) {
      const declared = compilation.imports.find((i) => i.name === bindingName);
      const bindings = admission.datasets.filter((d) => d.name === bindingName);
      if (
        !declared ||
        bindings.length !== 1 ||
        bindings[0]!.ref !== declared.ref ||
        !Number.isSafeInteger(bindings[0]!.version) ||
        bindings[0]!.version < 1 ||
        !validDigest(bindings[0]!.catalogSha256) ||
        !validDigest(bindings[0]!.policySha256)
      ) {
        block("dataset-binding-missing", name, sourceNode);
        continue;
      }
      if (bindings[0]!.selection !== "live-current")
        block("dataset-binding-mode-mismatch", name, sourceNode);
    }
    if (admission.datasets.some((d) => !imports.includes(d.name)))
      block("dataset-binding-extraneous", name, sourceNode);
    proof.status = blockers.some((b) => b.operation === name)
      ? "blocked"
      : "attested-plan";
  }
  const readGuarantees: NativeOperationGuarantee[] = [
    "typed-null-parameters",
    "full-source-results",
    "dependency-order",
    "cancel-stale-results",
    "revision-authority-fence",
  ];
  for (const query of compilation.queries) {
    const node = source("query", query.name);
    if (query.engine !== "sqlite" || query.source)
      block("query-engine-adapter-missing", query.name, node);
    add(
      "query",
      query.name,
      node,
      query,
      query.reads,
      "registered-sqlite-query",
      [
        ...readGuarantees,
        ...(query.reads.builtins.length
          ? ["actor-clock-bindings" as const]
          : []),
      ],
    );
  }
  for (const mutation of compilation.mutations) {
    const node = source("mutation", mutation.name);
    if (
      mutation.reset?.some(
        (name) =>
          !compilation.values.some(
            (v) => v.name === name && v.kind === "scalar",
          ),
      )
    )
      block("mutation-reset-value-missing", mutation.name, node);
    if (
      mutation.expectedAffected !== undefined &&
      (!Number.isSafeInteger(mutation.expectedAffected) ||
        mutation.expectedAffected < 0)
    )
      block("mutation-expected-affected-invalid", mutation.name, node);
    const targets =
      Number(!!mutation.target.import) + Number(!!mutation.target.local);
    if (targets !== 1) block("mutation-target-invalid", mutation.name, node);
    const reads = {
      ...mutation.reads,
      imports: [
        ...new Set([
          ...mutation.reads.imports,
          ...(mutation.target.import ? [mutation.target.import] : []),
        ]),
      ],
    };
    const route: NativeOperationRoute = historical
      ? "historical-readonly"
      : mutation.target.import
        ? "registered-dataset-mutation"
        : "apollo-local-mutation";
    const guarantees: NativeOperationGuarantee[] = historical
      ? ["revision-authority-fence"]
      : [
          "typed-null-parameters",
          "revision-authority-fence",
          "outcome-no-retry",
          ...(mutation.expectedAffected !== undefined
            ? ["expected-affected" as const]
            : []),
          ...(mutation.reset?.length ? ["commit-only-reset" as const] : []),
          ...(mutation.reads.builtins.length
            ? ["actor-clock-bindings" as const]
            : []),
        ];
    add("mutation", mutation.name, node, mutation, reads, route, guarantees);
  }
  for (const node of nodes.filter(
    (n) => n.type === "element" && (n.tag === "Chart" || n.tag === "Question"),
  )) {
    const name = node.graphKey,
      data = literal(node, "data"),
      viz = literal(node, "viz");
    const dependency =
      typeof data === "string" && /^\$[A-Za-z_]\w*$/.test(data)
        ? data.slice(1)
        : null;
    if (!dependency || !queries.has(dependency))
      block("visualization-query-binding-missing", name, node.graphKey);
    if (viz === undefined || viz === null)
      block("visualization-spec-admission-missing", name, node.graphKey);
    add(
      "visualization",
      name,
      node.graphKey,
      {
        attributes: node.type === "element" ? node.attributes : [],
        dependency,
      },
      {
        imports: [],
        queries: dependency ? [dependency] : [],
        values: [],
        builtins: [],
      },
      "native-vega",
      ["vega-spec-signals", "cancel-stale-results"],
    );
  }
  // A registered downstream operation cannot conceal an uncovered prerequisite.
  for (const name of [
    ...order,
    ...operations.filter((o) => o.kind !== "query").map((o) => o.name),
  ]) {
    const proof = operations.find((o) => o.name === name);
    if (!proof) continue;
    if (
      proof.dependencies.some(
        (dep) =>
          operations.find((o) => o.kind === "query" && o.name === dep)
            ?.status !== "attested-plan",
      )
    ) {
      block("query-upstream-uncovered", name, proof.sourceNode);
      proof.status = "blocked";
    }
  }
  return {
    sourceSha256: analysis.sourceSha256,
    compilerSourceSha256: analysis.compilerSourceSha256,
    sqlEngineSha256: input.sqlEngineSha256,
    operations,
    queryOrder: order,
    blockers,
  };
}
