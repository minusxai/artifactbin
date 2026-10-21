import { needsUnloadWarning } from "../durability.ts";
import type { RuntimeStatus } from "./platform-status-contracts.ts";
import type {
  PlatformStatus,
  PlatformStatusInput,
  PlatformStatusOptions,
} from "./platform-status-contracts.ts";
/** One precedence policy for visible status and unload warnings; observers cannot break it. */
export function createPlatformStatus(
  options: PlatformStatusOptions,
): PlatformStatus {
  let actionNotice: string | undefined;
  const observers = new Set<(status: RuntimeStatus) => void>();
  function snapshot(input: PlatformStatusInput): RuntimeStatus {
    return Object.freeze({
      mode: input.preview ? "preview" : input.remote ? "remote" : "file",
      dirty: needsUnloadWarning({
          hosted: input.hosted,
          fileDirty: input.fileDirty,
          recoveryFailed: false,
          pendingComments: input.pendingComments,
          drafts: input.drafts,
        }),
      sync: input.sync,
    });
  }
  function label(input: PlatformStatusInput, message?: string): string {
    // A publication without its own message keeps the session's (for example
    // "Connecting for live updates…") rather than a bare sync state.
    message ||= input.sessionMessage;
    if (message) return message;
    if (input.historical) return "Saved view — return to resume your work.";
    const value = input.hosted
      ? "Comments sync automatically"
      : input.preview
        ? input.fileDirty
          ? "Saving…"
          : "Saved to your file"
        : input.fileDirty
          ? "Unsaved local changes · Download a copy to keep them"
          : "Local file";
    return (
      value +
      (input.remote
        ? ` · ${input.sync === "synced" ? "Connected" : input.sync}`
        : "")
    );
  }
  function publish(message?: string): void {
    const input = options.read(),
      status = snapshot(input);
    const visible =
      actionNotice && input.sync === "error"
        ? label(input, message) + " · " + actionNotice
        : label(input, actionNotice || message);
    options.render(visible, status);
    for (const listener of [...observers])
      try {
        listener(status);
      } catch (error) {
        try {
          options.onObserverError?.(error);
        } catch {
          /* Observers have no publication authority. */
        }
      }
  }
  return {
    read: () => snapshot(options.read()),
    label: (message) => label(options.read(), message),
    notice(message) {
      actionNotice = message;
      publish();
    },
    clearNotice() {
      actionNotice = undefined;
      publish();
    },
    publish,
    subscribe(listener) {
      observers.add(listener);
      return () => {
        observers.delete(listener);
      };
    },
  };
}
