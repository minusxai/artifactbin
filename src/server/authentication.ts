import { emailAddress, requestCode, verifyCode } from "../email.ts";
import { fail } from "../errors.ts";
import {
  identityCrypto,
  passwordAccount,
  passwordAttempts,
} from "./identity-policy.ts";
import type {
  AuthenticationOptions,
  AuthenticationResult,
  AuthenticationService,
} from "./identity-contracts.ts";
/** Delivery occurs after commit. Failed guesses commit their consumed attempt. */
export function createAuthenticationService({
  repository,
  authority,
  now = Date.now,
  crypto = identityCrypto,
  allowPasswordLogin = true,
  sendCode,
}: AuthenticationOptions): AuthenticationService {
  const attempt = passwordAttempts();
  return {
    async execute(command) {
      if (command.kind === "password") {
        if (!allowPasswordLogin) fail(404, "Password sign-in is disabled");
        attempt(command.peer, now());
        return repository.withPasswordAccount(
          command.username,
          ({ account }) => {
            passwordAccount(account, command.password, crypto);
            const issued = authority.issue(command.username);
            return {
              issued,
              value: {
                status: 200,
                value: { token: issued.credential, username: command.username },
              },
            };
          },
        );
      }
      if (!sendCode) fail(503, "Email sign-in is not configured");
      const email = emailAddress(command.email);
      if (command.kind === "request-code") {
        const code = crypto.code(),
          salt = crypto.token();
        await repository.withEmailChallenge(email, ({ challenge }) => ({
          challenge: requestCode(
            challenge ?? undefined,
            now(),
            crypto.digest(salt + code),
            salt,
          ),
          value: undefined,
        }));
        try {
          await sendCode({ to: email, code });
        } catch {
          fail(503, "Email delivery failed. Please try again in a minute.");
        }
        return { status: 200, value: { sent: true } };
      }
      return repository.withEmailChallenge<AuthenticationResult>(
        email,
        ({ challenge, account }) => {
          if (!challenge) fail(401, "Code is invalid or expired");
          const result = verifyCode(
            challenge,
            now(),
            crypto.digest(challenge.salt + String(command.code || "")),
          );
          if (!result.verified)
            return {
              challenge: result.challenge,
              value: {
                status: 401,
                value: { error: "Code is invalid or expired" },
              },
            };
          const issued = authority.issue(email);
          return {
            challenge: result.challenge,
            ...(account ? {} : { createAccount: {} }),
            issued,
            value: {
              status: 200,
              value: { token: issued.credential, username: email },
            },
          };
        },
      );
    },
  };
}
