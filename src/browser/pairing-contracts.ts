import type {
  PlatformBinding,
  PlatformConnection,
} from "./platform-contracts.ts";
/** This result is confined to trusted shell or service-frame code. */
export interface CredentialedConnection extends PlatformConnection {
  token: string;
}
export interface PairingExchangeOptions {
  /** Explicit document grants include shared app data; legacy collaboration grants do not. */
  purpose?: "collaboration" | "document";
  origin: string;
  binding: PlatformBinding;
  signal: AbortSignal;
  approve(url: string): void;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}
export interface TrustedConnection {
  connect(
    origin: string,
    binding: PlatformBinding,
    approve: (url: string) => void,
  ): Promise<CredentialedConnection>;
  cancel(): void;
}
