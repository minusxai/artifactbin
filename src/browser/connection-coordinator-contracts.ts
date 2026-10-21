import type {
  PlatformBinding,
  PlatformClient,
  PlatformConnection,
  PlatformEvent,
} from "./platform-contracts.ts";
import type { TrustedConnection } from "./pairing-contracts.ts";
import type { PublicationGate } from "./lifecycle-contracts.ts";
export interface ConnectionPopup {
  navigate(url: string): void;
  close(): void;
}
export interface ConnectedIdentity extends PlatformConnection {
  origin: string;
  session: string | true;
}
export interface ConnectionCoordinatorOptions {
  local: boolean;
  binding(): PlatformBinding & { origin?: string };
  gate: Pick<PublicationGate, "epoch" | "active" | "accepts" | "assert">;
  createClient(
    options: PlatformBinding & {
      origin: string;
      onEvent(event: PlatformEvent): void;
    },
  ): PlatformClient;
  trusted?: TrustedConnection | null;
  openPopup(): ConnectionPopup | null;
  approveLink(url: string): void;
  onEvent(event: PlatformEvent): void;
  /** Apply publication and identity before the connection completes. */
  apply(result: ConnectedIdentity): void;
  connected(): Promise<void>;
}
export interface ConnectionCoordinator {
  broker(origin?: string): PlatformClient;
  existingBroker(): PlatformClient | null;
  connect(origin?: string): Promise<void>;
  cancel(): void;
  disconnect(): Promise<void>;
  dispose(): void;
}
