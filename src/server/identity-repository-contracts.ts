import type { Profile } from "../contracts.ts";
import type {
  Account,
  EmailChallenge,
  SessionGrant,
} from "../identity-data-contracts.ts";
export interface IssuedSession {
  credential: string;
  tokenHash: string;
  session: SessionGrant;
}
/** Required rows are read before the callback. Null always means absent. */
export interface PasswordIdentityContext {
  account: Account | null;
}
export interface EmailIdentityContext extends PasswordIdentityContext {
  challenge: EmailChallenge | null;
}
export interface PasswordIdentityTransition<T> {
  value: T;
  issued?: IssuedSession;
}
export interface EmailIdentityTransition<T>
  extends PasswordIdentityTransition<T> {
  challenge?: EmailChallenge;
  createAccount?: Account;
}
export interface AccountProfileRecord {
  name: string | null;
  image: string | null;
}
export interface IdentityRepository {
  readSession(tokenHash: string): Promise<SessionGrant | null>;
  createAccount(actor: string, account: Account): Promise<boolean>;
  withPasswordAccount<T>(
    actor: string,
    operation: (
      context: PasswordIdentityContext,
    ) => PasswordIdentityTransition<T> | Promise<PasswordIdentityTransition<T>>,
  ): Promise<T>;
  withEmailChallenge<T>(
    email: string,
    operation: (
      context: EmailIdentityContext,
    ) => EmailIdentityTransition<T> | Promise<EmailIdentityTransition<T>>,
  ): Promise<T>;
  readProfile(actor: string): Promise<AccountProfileRecord | null>;
  updateProfile(
    actor: string,
    profile: Profile,
  ): Promise<AccountProfileRecord | null>;
  revokeSession(tokenHash: string): Promise<void>;
}
export interface IdentityCrypto {
  token(): string;
  code(): string;
  digest(value: string): string;
  passwordDigest(password: string, salt: string): string;
  equalDigest(actual: string, expected: string): boolean;
}
