/** The hosted page's status, as the platform UI shows it. */
export interface RuntimeStatus {
  mode: "file" | "preview" | "remote";
  dirty: boolean;
  sync: "disconnected" | "pending" | "syncing" | "synced" | "error";
}
export type SaveResult = "written" | "download-started" | "cancelled";
export interface PlatformStatusInput {
  hosted: boolean;
  preview: boolean;
  remote: boolean;
  historical: boolean;
  fileDirty: boolean;
  pendingComments: number;
  drafts: Readonly<Record<string, string>>;
  sync: RuntimeStatus["sync"];
  /** The live session's own message ("Connecting for live updates…"), shown until it clears it. */
  sessionMessage?: string;
}
export interface PlatformStatus {
  read(): RuntimeStatus;
  label(message?: string): string;
  publish(message?: string): void;
  /** Action errors survive background publications until the next user action;
   * critical save/conflict/connection warnings remain visible alongside them. */
  notice(message: string): void;
  clearNotice(): void;
  subscribe(listener: (status: RuntimeStatus) => void): () => void;
}
export interface PlatformStatusOptions {
  read(): PlatformStatusInput;
  render(label: string, status: RuntimeStatus): void;
  onObserverError?(error: unknown): void;
}
