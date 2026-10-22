import type { BoundValueColumnProof } from "./bound-value-contracts.ts";
import type { CompiledDatasetBinding } from "./dataset-contracts.ts";
import { validBoundValueProof } from "./bound-value-proof.ts";
/** Validate source-owned declarations against the importer proof and exact schema snapshot. */
export function validateBoundFlow(
  flow: any,
  bindings: readonly CompiledDatasetBinding[],
  proofs: readonly BoundValueColumnProof[],
): void {
  const values = flow.values.filter(
    (v: any) => v.kind === "scalar" && v.source,
  );
  if (
    !Array.isArray(proofs) ||
    proofs.length > 256 ||
    proofs.length !== values.length ||
    proofs.some((p) => !validBoundValueProof(p)) ||
    new Set(proofs.map((p) => p.valueName)).size !== proofs.length
  )
    throw Error("Bound Value proof required");
  for (const value of values) {
    const matches = proofs.filter(
      (p) =>
        p.valueName === value.name &&
        p.sourceRef === `ref:${value.source}` &&
        p.column === value.column,
    );
    if (
      matches.length !== 1 ||
      value.type !== "user" ||
      value.constraints !== undefined
    )
      throw Error("Bound Value declaration mismatch");
    const proof = matches[0]!,
      selected = bindings.filter(
        (b) =>
          b.name === proof.bindingName &&
          b.legacyRef === proof.sourceRef &&
          b.version === proof.version,
      );
    if (
      selected.length !== 1 ||
      !flow.imports.some(
        (i: any) =>
          i.name === proof.bindingName && `ref:${i.ref}` === proof.sourceRef,
      )
    )
      throw Error("Bound Value import mismatch");
    const columns = selected[0]!.tables
      .filter((t) => t.schema === proof.schema && t.table === proof.table)
      .flatMap((t) =>
        t.columns.filter((c) => c.name === proof.column && c.type === "user"),
      );
    if (columns.length !== 1) throw Error("Bound Value column mismatch");
    if (
      proofs.some(
        (p) =>
          p.sourceRef === proof.sourceRef &&
          p.schema === proof.schema &&
          p.table === proof.table &&
          p.column === proof.column &&
          JSON.stringify(p.constraints) !== JSON.stringify(proof.constraints),
      )
    )
      throw Error("Conflicting bound Value constraints");
  }
}
/** Runtime local evaluation uses typed scalar values only. Policy stays on the trusted backend.
 * Strip at schema metadata slots, never inside authored rows or JSON cell values. */
export function publicBoundFlow(
  flow: any,
  proofs: readonly BoundValueColumnProof[],
): any {
  if (!proofs.length) return flow;
  const publicColumns = (columns: any[]) =>
    columns.map(({ constraints, ...c }: any) => {
      void constraints;
      return c;
    });
  return {
    ...flow,
    values: flow.values.map((v: any) => {
      if (!proofs.some((p) => p.valueName === v.name)) return v;
      const { source, column, constraints, ...scalar } = v;
      void source;
      void column;
      void constraints;
      return scalar;
    }),
    imports: flow.imports.map((i: any) => ({
      ...i,
      tables: i.tables.map((t: any) => ({
        ...t,
        columns: publicColumns(t.columns),
      })),
    })),
    queries: flow.queries.map((q: any) => ({
      ...q,
      ...(q.columns ? { columns: publicColumns(q.columns) } : {}),
    })),
  };
}
