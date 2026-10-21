import type { FilePermissions } from "../contracts.ts";
import type { SessionGrant } from "../identity-data-contracts.ts";
import type { DocumentAuthorizationRecord } from "./document-authorization-contracts.ts";
import type {
  IdentityCrypto,
  IdentityRepository,
  IssuedSession,
} from "./identity-repository-contracts.ts";
export interface IdentityAuthority {
  issue(
    actor: string,
    fileId?: string | null,
    generation?: number | null,
  ): IssuedSession;
  account(session: SessionGrant | null): string;
  document(
    context: {
      document: DocumentAuthorizationRecord | null;
      session: SessionGrant | null;
    },
    credential: string,
    id: string,
  ): {
    file: DocumentAuthorizationRecord;
    actor: string | null;
    owner: boolean;
    permissions: FilePermissions;
    appEdit: boolean;
  };
}
export type AuthenticationCommand =
  | { kind: "password"; username: string; password: unknown; peer: string }
  | { kind: "request-code"; email: unknown }
  | { kind: "verify-code"; email: unknown; code: unknown };
export interface AuthenticationResult {
  status: number;
  value: { sent?: true; token?: string; username?: string; error?: string };
}
export interface AuthenticationService {
  execute(command: AuthenticationCommand): Promise<AuthenticationResult>;
}
export interface AuthenticationOptions {
  repository: IdentityRepository;
  authority: IdentityAuthority;
  now?: () => number;
  crypto?: IdentityCrypto;
  allowPasswordLogin?: boolean;
  sendCode?: (message: { to: string; code: string }) => Promise<void>;
}
