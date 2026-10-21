/** Build-injected assets; declarations do not provide runtime authority. */
declare const PAGEGI_CSS: string;
declare const PAGEGI_BRIDGE: string;
interface Window {
  __pagegiTrustedConnection?: import("./pairing-contracts.ts").TrustedConnection;
  pagegi: Pick<
    { save(): Promise<import("./platform-status-contracts.ts").SaveResult>; getStatus(): import("./platform-status-contracts.ts").RuntimeStatus; subscribeStatus(listener: (status: import("./platform-status-contracts.ts").RuntimeStatus) => void): () => void },
    "save" | "getStatus" | "subscribeStatus"
  >;
}
