/**
 * Where artifact BYTES live.
 *
 * A dataset is the first thing this repo stores that is genuinely large — a
 * real Google Sheet came in at 27 MB — and a Postgres TEXT column is the wrong
 * home for it: every render and every /edits write reads and parses the whole
 * blob, and PGLite holds it in one process. So the blob goes to an object
 * store and the database keeps a reference.
 *
 * The whole storage concern lives behind put/get/delete on a key. Nothing
 * upstream knows whether that key resolves to S3 or the local filesystem, which
 * is what keeps `S3_URL` optional: unset, the app still runs on a laptop and in
 * CI with no external service, which is the same promise PGLite makes.
 */
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { S3_URL, LOCAL_OBJECT_DIR } from '@/lib/config';
import { parseS3Url, storageKeyFor, type S3Config } from './url';

export * from './url';

/**
 * A read the store could not satisfy — missing object OR broken credentials,
 * deliberately undistinguished: every key the app asks for is one a DB row
 * recorded (THE DB IS THE ONLY INDEX), so either answer means a row promises
 * bytes the store will not give. Consumers treat it as an ERROR, never as an
 * empty result. Which is also why the IAM user never needs s3:ListBucket (the
 * permission S3 wants before it will say "404" rather than "403").
 */
export class ObjectUnavailable extends Error {
  constructor(public readonly key: string, public readonly cause?: unknown) {
    super(`object unavailable: ${key}${cause instanceof Error ? ` (${cause.message})` : ''}`);
    this.name = 'ObjectUnavailable';
  }
}

/** A content-addressed key. Same bytes twice costs one object, not two. */
export function objectKey(kind: string, bytes: Buffer | string): string {
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return `${kind}/${digest}`;
}

/** A unique key, for content that must not be deduplicated. */
export function uniqueObjectKey(kind: string): string {
  return `${kind}/${randomBytes(16).toString('hex')}`;
}

export interface ObjectStore {
  readonly backend: 's3' | 'local';
  put(key: string, body: Buffer | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/**
 * THE ONE READ CACHE, AND IT BELONGS HERE.
 *
 * Every key this app reads is IMMUTABLE: content-addressed (`kind/sha256` for
 * datasets, ref images and webfonts) or version-addressed
 * (`exports/<id>/<version>…`). So caching at the STORE serves every reader —
 * the document build, `/query`, mutate, the `ref:` image route, `/webfonts`
 * and the exporter — instead of one cache per caller, which is how a
 * dataset-only cache becomes four caches nobody can reason about.
 *
 * Measured before it existed: a document reading three datasets fetched all
 * three from S3 on EVERY render and every query — 3.6s to first byte, and
 * `select 1` through the document's own transport at 4.5s.
 *
 * The PROMISE is cached, so concurrent readers of one document share a single
 * fetch. A FAILURE is never kept — a store that could not answer is asked
 * again rather than being wrong until restart. A WRITE or DELETE forgets the
 * key, so the immutability above is a reason this is cheap, not a rule the
 * cache depends on. The budget is in BYTES, because these range from a 2 KB
 * webfont to a 27 MB sheet and counting entries would bound nothing.
 */
const READ_CACHE_BYTES = 32 * 1024 * 1024;

interface CachedRead { bytes: number; reading: Promise<Buffer> }
const reads = new Map<string, CachedRead>();
let readBytes = 0;

/** Test seam: forget everything read so far. */
export function resetReadCache(): void { reads.clear(); readBytes = 0; }

const forget = (key: string): void => {
  const held = reads.get(key);
  if (!held) return;
  reads.delete(key);
  readBytes -= held.bytes;
};

/** Wrap a store so repeated reads of one key cost one fetch. */
export function cachedReads(store: ObjectStore): ObjectStore {
  return {
    backend: store.backend,
    async put(key, body, contentType) { forget(key); return store.put(key, body, contentType); },
    async delete(key) { forget(key); return store.delete(key); },
    get(key) {
      const held = reads.get(key);
      if (held) return held.reading;
      const entry: CachedRead = {
        bytes: 0,
        reading: store.get(key).then(
          (bytes) => {
            // Admit it only if it fits; a single object larger than the whole
            // budget is served and forgotten rather than evicting everything.
            if (bytes.byteLength <= READ_CACHE_BYTES) {
              entry.bytes = bytes.byteLength;
              readBytes += bytes.byteLength;
              while (readBytes > READ_CACHE_BYTES) {
                const oldest = reads.keys().next().value;
                if (oldest === undefined || oldest === key) break;
                forget(oldest);
              }
            } else {
              reads.delete(key);
            }
            return bytes;
          },
          (error) => { forget(key); throw error; },
        ),
      };
      reads.set(key, entry);
      return entry.reading;
    },
  };
}

let cached: ObjectStore | null = null;

/**
 * The store the app uses, from configuration. The two constructors below are
 * exported so tests can build a store against a temp directory or a live MinIO
 * without going through module-level config, which freezes at import.
 */
export function objectStore(): ObjectStore {
  if (cached) return cached;
  cached = cachedReads(S3_URL ? createS3Store(parseS3Url(S3_URL)) : createLocalStore(LOCAL_OBJECT_DIR));
  return cached;
}


const nodeRequire = createRequire(import.meta.url);

export function createS3Store(config: S3Config): ObjectStore {
  // Imported lazily so the AWS SDK is not loaded at all when running on the
  // local fallback — the sanctioned exception pattern lib/db.ts documents.
  // `createRequire` rather than a bare `require`: this package is ESM, so the
  // synchronous escape hatch has to be asked for by name.
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, NoSuchKey } = nodeRequire('@aws-sdk/client-s3');
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    backend: 's3',
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket, Key: storageKeyFor(config, key), Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: storageKeyFor(config, key) }));
        const chunks: Uint8Array[] = [];
        for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
        return Buffer.concat(chunks);
      } catch (error) {
        // Missing (404 NoSuchKey, only ever seen by a caller that may list) and
        // denied (403, what an absent key looks like WITHOUT ListBucket) are the
        // same failure to a consumer — see ObjectUnavailable.
        throw new ObjectUnavailable(key, error);
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKeyFor(config, key) }));
    },
  };
}

export function createLocalStore(dir: string): ObjectStore {
  // Resolve the ROOT once: a relative LOCAL_OBJECT_DIR (the default) would
  // otherwise never prefix-match the absolute path below, and every legitimate
  // key would be rejected as an escape attempt.
  const root = path.resolve(dir);
  // Keys contain '/', so they nest as directories. Checked against the root
  // because a key is derived from input and '../' would otherwise write out.
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Refusing key outside the object store: "${key}"`);
    return full;
  };
  return {
    backend: 'local',
    async put(key, body) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async get(key) {
      try {
        return await readFile(resolve(key));
      } catch (error) {
        throw new ObjectUnavailable(key, error);
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

/**
 * THE BOOT CANARY: put and get one object under the store's own prefix. A
 * bad S3_URL, wrong credentials or a missing bucket fail HERE, at startup,
 * with the store named — not on the first user's request as a bare
 * ObjectUnavailable that cannot say whether the key or the credentials are
 * the problem. Diagnostic only; nothing else depends on it.
 */
export async function verifyObjectStore(store: ObjectStore = objectStore()): Promise<{ backend: ObjectStore['backend']; ms: number }> {
  const key = `_health/${randomBytes(8).toString('hex')}`;
  const t0 = Date.now();
  try {
    await store.put(key, Buffer.from('ok'), 'text/plain');
    const back = await store.get(key);
    if (back.toString('utf8') !== 'ok') throw new Error('read back different bytes');
    await store.delete(key).catch(() => {});
  } catch (error) {
    throw new Error(`object store (${store.backend}) unusable: ${(error as Error)?.message ?? String(error)}`, { cause: error });
  }
  return { backend: store.backend, ms: Date.now() - t0 };
}
