import { profileInput } from "../chrome-model.ts";
import { fail } from "../errors.ts";
import { newPasswordAccount, identityCrypto } from "./identity-policy.ts";
import type { IdentityAuthority } from "./identity-contracts.ts";
import type {
  IdentityCrypto,
  IdentityRepository,
} from "./identity-repository-contracts.ts";
export function createAccountService({
  repository,
  authority,
  crypto = identityCrypto,
}: {
  repository: IdentityRepository;
  authority: IdentityAuthority;
  crypto?: IdentityCrypto;
}) {
  return {
    async add(username: string, password: string): Promise<void> {
      const account = newPasswordAccount(username, password, crypto);
      if (!(await repository.createAccount(username, account)))
        throw Error("Account already exists");
    },
    async actor(tokenHash: string): Promise<string> {
      return authority.account(await repository.readSession(tokenHash));
    },
    async profile(
      actor: string,
      input?: { name?: string; image?: string | null },
    ) {
      const account =
        input === undefined
          ? await repository.readProfile(actor)
          : await repository.updateProfile(actor, profileInput(input));
      if (!account) fail(401, "Sign in required");
      return { name: account.name || actor, image: account.image || null };
    },
    async revoke(tokenHash: string): Promise<void> {
      await repository.revokeSession(tokenHash);
    },
  };
}
