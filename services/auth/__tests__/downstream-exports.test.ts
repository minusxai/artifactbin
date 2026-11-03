/**
 * WHAT THE DEPLOYMENT IMPORTS FROM @artifactbin/auth. The private server repository
 * (minusxai/artifactbin-server) composes its proxy from these names and paths; removing one breaks that build,
 * which no other check here sees. Named imports, so knip's entry-export check (knip.config.js
 * `includeEntryExports`) counts them as used and refuses every other unused export. Regenerated from
 * artifactbin-server f1741b6 on 2026-11-03: change a line only together with that repository.
 */
import { expect, expectTypeOf, it } from 'vitest';
import {
  authEnvNamesRead, createBearerReader, ensureAuthSchema, ensureHumanAuthSchema, internalBoundary, loginProvidersOf,
  loginRoutes, oauthRoutes, resendMailer, session, sessionStoreOf, testDomainSignInOf,
  type LoginProviders, type OutgoingMail, type SessionInfo, type SessionStore,
} from '@artifactbin/auth';
import { migrateHumanAccountSchema } from '@artifactbin/auth/auth/account-migration';
import { createHumanAuth, humanAuthOptions, type BetterAuthOptions, type HumanAuth, type HumanAuthOptions, type Mailer, type OidcProvider } from '@artifactbin/auth/auth/human';
import { pgliteDialect } from '@artifactbin/auth/auth/pglite';
import { createOAuthStore } from '@artifactbin/auth/identity/oauth';
import { DEV_OUTBOX_DEFAULT_PATH, DEV_OUTBOX_RELATIVE_PATH, MailNotConfigured, MailSendFailed, devOutboxMailer, mailerForRuntime, usesDevOutbox } from '@artifactbin/auth/mail';
import { baseUrlOf } from '@artifactbin/auth/routes/oauth';
import { sessionAuthority } from '@artifactbin/auth/session-authority';

it('exports the values the deployment imports', () => {
  const values = {
    authEnvNamesRead, createBearerReader, ensureAuthSchema, ensureHumanAuthSchema, internalBoundary, loginProvidersOf, loginRoutes, oauthRoutes,
    resendMailer, session, sessionStoreOf, testDomainSignInOf, migrateHumanAccountSchema, createHumanAuth, humanAuthOptions, pgliteDialect,
    createOAuthStore, DEV_OUTBOX_DEFAULT_PATH, DEV_OUTBOX_RELATIVE_PATH, MailNotConfigured, MailSendFailed, devOutboxMailer, mailerForRuntime,
    usesDevOutbox, baseUrlOf, sessionAuthority,
  };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the types the deployment imports', () => {
  expectTypeOf<[LoginProviders, OutgoingMail, SessionInfo, SessionStore, BetterAuthOptions, HumanAuth, HumanAuthOptions, Mailer, OidcProvider]>().not.toBeNever();
});
