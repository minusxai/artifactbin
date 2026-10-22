import type { Cursor, Id, Snapshot, Theme, Viewport } from "../contracts.ts";
import type { RuntimeStatus, SaveResult } from "./platform-status-contracts.ts";

/** Messages and target geometry exchanged between a page and its browser host. */
export interface Target {
  id: Id;
  quote: string;
  rect: { x: number; y: number; width: number; height: number };
}
export type AppMessage =
  | {
      pagegi: true;
      kind: "context";
      nodeId: Id | null;
      quote: string;
      snapshot: Snapshot;
      x: number;
      y: number;
    }
  | { pagegi: true; kind: "dismiss" }
  | {
      pagegi: true;
      kind: "view";
      snapshot: Snapshot | null;
      targets: Target[];
      /** False while the design system's stylesheet is still loading; the loading screen waits for it. */
      styled?: boolean;
    }
  | {
      pagegi: true;
      kind: "pick";
      nodeId: Id | null;
      quote: string;
      snapshot: Snapshot | null;
    }
  | { pagegi: true; kind: "cursor"; cursor: Cursor }
  | { pagegi: true; kind: "save"; id: Id }
  | { pagegi: true; kind: "error"; message: string };
export type HostMessage =
  | { pagegi: true; kind: "theme"; theme: Theme }
  | { pagegi: true; kind: "mode"; on: boolean }
  | { pagegi: true; kind: "status"; status: RuntimeStatus }
  | { pagegi: true; kind: "saved"; id: Id; result?: SaveResult; error?: string }
  | { pagegi: true; kind: "scroll"; view: Viewport };
