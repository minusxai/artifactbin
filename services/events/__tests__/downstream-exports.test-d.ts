/** The downstream type contract, checked by TypeScript alongside the runtime export tests. */
import { expectTypeOf } from 'vitest';
import type { EventEnvelope, EventSink, Queryable } from '@artifactbin/events';

expectTypeOf<[EventEnvelope, EventSink, Queryable]>().not.toBeNever();
