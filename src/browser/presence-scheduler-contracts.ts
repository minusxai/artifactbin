import type { Cursor, PresenceInput } from "../contracts.ts";
import type { SessionClock } from "./collaboration-session-contracts.ts";
export interface PresenceSchedulerOptions {
  read(): { authenticated: boolean; active: boolean; presence: PresenceInput };
  publish(presence: PresenceInput): void;
  publishCursor(cursor: Cursor | null): void;
  clock?: SessionClock;
}
export interface PresenceScheduler {
  send(): void;
  schedule(): void;
  cursor(): void;
  selection(): void;
  cancel(): void;
}
