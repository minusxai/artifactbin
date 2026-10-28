import {
  mkdir,
  realpath,
  writeFile,
  readFile,
  link,
  unlink,
  lstat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { storageKeyFor, type S3Config } from "@/lib/object-store";
import type { NativeImmutableObjectSink } from "./catalog-contracts";
export function assertNativeObjectKey(key: string) {
  if (
    !key ||
    !/^[-A-Za-z0-9_./]+$/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw Error("native_catalog_object_key");
}
/** Explicit directory only, never configured/account storage by default. A hard
 * link publishes completed bytes atomically without replacing an existing key. */
export async function createNativeLocalObjectSink(
  directory: string,
): Promise<NativeImmutableObjectSink> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  const locate = async (key: string, create = false) => {
    assertNativeObjectKey(key);
    const parts = key.split("/");
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (create)
        await mkdir(parent, { mode: 0o700 }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          },
        );
      const stat = await lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("native_catalog_object_symlink");
    }
    return path.join(parent, parts.at(-1)!);
  };
  return {
    async get(key) {
      const file = await locate(key);
      if ((await lstat(file)).isSymbolicLink())
        throw Error("native_catalog_object_symlink");
      return readFile(file);
    },
    async putIfAbsent(key, bytes) {
      const file = await locate(key, true),
        temporary = file + "." + randomUUID() + ".staging";
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      try {
        try {
          await link(temporary, file);
          return "created";
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          return "exists";
        }
      } finally {
        await unlink(temporary);
      }
    },
  };
}
/** Conditional S3 writes are a deliberate lazy SDK boundary, matching the
 * existing object-store factory. No connection or request occurs at import. */
/** @public Host-owned S3 staging factory. */
export function createNativeS3ObjectSink(
  config: S3Config,
): NativeImmutableObjectSink {
  const loadAws = createRequire(import.meta.url),
    {
      S3Client,
      PutObjectCommand,
      GetObjectCommand,
    } = loadAws("@aws-sdk/client-s3");
  const client = new S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestHandler: {
      connectionTimeout: 5000,
      requestTimeout: 30000,
      throwOnRequestTimeout: true,
    },
  });
  return {
    async get(key) {
      assertNativeObjectKey(key);
      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: storageKeyFor(config, key),
        }),
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>)
        chunks.push(chunk);
      return Buffer.concat(chunks);
    },
    async putIfAbsent(key, bytes, contentType) {
      assertNativeObjectKey(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: storageKeyFor(config, key),
            Body: bytes,
            IfNoneMatch: "*",
            ...(contentType ? { ContentType: contentType } : {}),
          }),
        );
        return "created";
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (status === 412) return "exists";
        throw error;
      }
    },
  };
}
