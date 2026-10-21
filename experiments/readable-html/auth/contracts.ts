/** Validation spike contracts. No production endpoint is installed. */
export interface GrantRequest {
  documentId: string;
  channel: string;
  challenge: string;
}
export interface Grant {
  code: string;
  request: GrantRequest;
  expiresAt: number;
  generation: number;
}
export interface Redemption extends GrantRequest {
  code: string;
  verifier: string;
}
export interface Session {
  token: string;
  documentId: string;
  expiresAt: number;
  generation: number;
}
export interface AuthPolicy {
  issue(account: string | undefined, request: GrantRequest): Grant;
  redeem(request: Redemption): Session;
  authorize(token: string | undefined, documentId: string): boolean;
  revoke(): void;
}
/** Presentation only. This value MUST NOT be accepted by AuthPolicy. */
export interface ChromeOffer {
  type: "chrome-offer";
  version: 1;
  channel: string;
  topbar: boolean;
  modals: boolean;
}
export interface ChromeOwner {
  origin: string;
  offer: ChromeOffer;
}
export interface PairingPolicy {
  begin(request: GrantRequest): {
    requestId: string;
    documentId: string;
    expiresAt: number;
  };
  describe(requestId: string): { documentId: string; expiresAt: number };
  approve(account: string | undefined, requestId: string): void;
  poll(requestId: string, verifier: string): Session | null;
}
