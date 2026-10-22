import type { Profile, Viewer } from "../contracts.ts";

/** Keyed viewer controls: profile refreshes preserve both the button and its pointer targets. */
export interface ViewerControls {
  /** Surviving actors retain their controls; activation uses their latest session. Removed actors disappear. */
  render(
    viewers: readonly Viewer[],
    profiles: Readonly<Record<string, Profile>>,
  ): void;
  dispose(): void;
}
