import { AsyncLocalStorage } from 'node:async_hooks';
import type { ObjectStore } from '@/lib/object-store';

export type ContentObjects = Pick<ObjectStore, 'get' | 'put'>;
export interface PreparedObject {key: string; bytes: Buffer; contentType?: string}

/** Private request-local bytes. The only external capability is a reader. */
export function prepareObjects(reader: Pick<ObjectStore, 'get'>): {store: ContentObjects; objects: PreparedObject[]} {
  const objects: PreparedObject[] = [];
  const byKey = new Map<string, PreparedObject>();
  return {
    objects,
    store: {
      async get(key) { return byKey.get(key)?.bytes ?? reader.get(key); },
      async put(key, body, contentType) {
        const bytes = Buffer.from(body);
        const prior = byKey.get(key);
        if (prior) {
          if (!prior.bytes.equals(bytes) || prior.contentType !== contentType) throw new Error('Prepared object key collision');
          return;
        }
        const object = {key, bytes, contentType};
        byKey.set(key, object);
        objects.push(object);
      },
    },
  };
}

const staged = new AsyncLocalStorage<ReadonlyMap<string, PreparedObject>>();
/**
 * Runs `work` with these prepared objects readable through objectStore() before they are stored: a publication's
 * transaction validates the bytes it puts only as its last step (lib/publish preparedPersistence).
 */
export function readingPrepared<T>(objects: readonly PreparedObject[], work: () => Promise<T>): Promise<T> {
  return staged.run(new Map(objects.map(object => [object.key, object])), work);
}
/** The prepared object `key` names in the current `readingPrepared` scope, if any. */
export const stagedObject = (key: string): PreparedObject | undefined => staged.getStore()?.get(key);
