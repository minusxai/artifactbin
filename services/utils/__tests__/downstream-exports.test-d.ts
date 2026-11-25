/** The downstream type contract, checked by TypeScript alongside the runtime export tests. */
import { expectTypeOf } from 'vitest';
import type { EventObject, EventSubject, FakeEvents } from '@artifactbin/utils';

expectTypeOf<[EventObject, EventSubject, FakeEvents]>().not.toBeNever();
