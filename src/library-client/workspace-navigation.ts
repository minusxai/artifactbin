import type { WorkspaceNavigation } from "./view-contracts.ts";
/** Keep the shell out of signed-out, loading and failed session surfaces. */
export function workspaceNavigation(screen: string): WorkspaceNavigation {
  return {
    visible: screen === "library" || screen === "account",
    active: screen === "account" ? "account" : "artifacts",
  };
}
