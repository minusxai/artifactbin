/** The downstream type contract, checked by TypeScript alongside the runtime export tests. */
import { expectTypeOf } from 'vitest';
import type { MutationInvocationFactory } from '@/lib/artifacts/mutation-invocation';
import type { Db } from '@/lib/platform/db';
import type { AppHostOptions, NotificationDelivery } from '@/server/host';

expectTypeOf<[MutationInvocationFactory, Db, AppHostOptions, NotificationDelivery]>().not.toBeNever();
