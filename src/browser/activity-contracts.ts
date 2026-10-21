/** Independent reasons cannot accidentally resume one another's suspended work. */
export type ActivityReason = "history" | "page-cache" | "saved-context";
export interface ActivityParticipant {
  suspend(): void;
  /** Invalidate pending reads when another suspension begins while already suspended. */
  invalidate?(): void;
  resume(): void;
  dispose(): void;
}
export interface DocumentActivity {
  readonly active: boolean;
  suspend(reason: ActivityReason): void;
  resume(reason: ActivityReason): void;
  dispose(): void;
}

/** Owned callbacks settle independently; all failures remain observable. */
export type ActivityCallback = () => void;
