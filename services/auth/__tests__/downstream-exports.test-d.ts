/** The downstream type contract, checked by TypeScript alongside the runtime export tests. */
import { expectTypeOf } from 'vitest';
import type { publicBuildAssets } from '@artifactbin/auth/parts';
import type { LoginProviders, OutgoingMail, SessionInfo, SessionStore } from '@artifactbin/auth';
import type { BetterAuthOptions, HumanAuth, HumanAuthOptions, Mailer, OidcProvider } from '@artifactbin/auth/auth/human';
import type { Part, Upstream } from '@artifactbin/contracts/part';

expectTypeOf<[
  LoginProviders, OutgoingMail, SessionInfo, SessionStore,
  BetterAuthOptions, HumanAuth, HumanAuthOptions, Mailer, OidcProvider,
]>().not.toBeNever();

type Env = { Variables: { deployment: string } };
expectTypeOf<typeof publicBuildAssets<Env>>()
  .toEqualTypeOf<(options: { upstream: Upstream; deadlineMs?: number }) => Part<Env>>();
