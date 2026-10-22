import type { DatasetColumn } from "../sql/engine/sql-contracts.ts";
import { DatasetMutationError } from "./contracts.ts";
export interface UserAssignmentFacts {
  callerUserId: string | null;
  knownUserIds: readonly string[];
  members: ReadonlyMap<string, ReadonlySet<string>>;
}
/** Values come from actual changed cells, including presets, never request parameters. */
export function validateUserAssignments(
  columns: readonly DatasetColumn[],
  rows: readonly Record<string, unknown>[],
  facts: UserAssignmentFacts,
): void {
  const denied = (): never => {
    throw new DatasetMutationError("invalid_user_assignment");
  };
  const known = new Set(facts.knownUserIds);
  for (const column of columns.filter((c) => c.type === "user")) {
    const values = new Set(
      rows
        .filter((row) => Object.hasOwn(row, column.name))
        .map((row) => row[column.name])
        .filter((v) => v !== null),
    );
    for (const value of values) {
      if (typeof value !== "string" || !known.has(value)) denied();
      if (column.constraints?.self && value !== facts.callerUserId) denied();
      const refs = column.constraints?.memberOf;
      if (
        refs &&
        (refs.includes("current") ||
          !refs.some((ref) => facts.members.get(ref)?.has(value as string)))
      )
        denied();
    }
  }
}
