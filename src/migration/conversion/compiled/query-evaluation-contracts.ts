/** One logical evaluation, shared by its initial query and completion pages. */
export interface CompiledQueryEvaluation {
  readonly values: Readonly<Record<string, unknown>>;
  readonly localTables: Readonly<Record<string, unknown>>;
  readonly userId: string | null;
  readonly now: string;
  readonly tz: "UTC";
  readonly members?: readonly { user_id: string; joined_at: string }[];
}
