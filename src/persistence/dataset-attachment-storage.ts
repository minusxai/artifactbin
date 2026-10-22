import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, rm, lstat, link } from "node:fs/promises";
import { join } from "node:path";
import type { DatasetAttachmentStorageOptions } from "./dataset-attachment-storage-contracts.ts";
import type {
  DatasetAttachmentStorage,
  DatasetAttachmentMime,
  DatasetAttachmentObject,
} from "../datasets/attachments/contracts.ts";
import {
  DATASET_ATTACHMENT_LIMITS,
  DatasetAttachmentError,
} from "../datasets/attachments/contracts.ts";
function sniff(b: Buffer): DatasetAttachmentMime | null {
  if (b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
async function secureDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
    throw new DatasetAttachmentError("unavailable");
}
async function inspect(path: string, signal?: AbortSignal) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const s = await file.stat();
    if (
      !s.isFile() ||
      s.size <= 0 ||
      s.size > DATASET_ATTACHMENT_LIMITS.datasetBytes
    )
      throw new DatasetAttachmentError("invalid_request");
    const hash = createHash("sha256");
    let length = 0;
    let header = Buffer.alloc(0);
    for await (const c of file.createReadStream({ autoClose: false })) {
      signal?.throwIfAborted();
      length += c.length;
      if (length > DATASET_ATTACHMENT_LIMITS.datasetBytes)
        throw new DatasetAttachmentError("too_large");
      hash.update(c);
      if (header.length < 12)
        header = Buffer.concat([header, c.subarray(0, 12 - header.length)]);
    }
    return {
      sha256: hash.digest("hex"),
      byteLength: length,
      contentType: sniff(header),
    };
  } finally {
    await file.close();
  }
}
/** App-owned immutable overlay. No caller URL or filename participates in an object path. */
export function createDatasetAttachmentStorage({
  directory,
  processor,
}: DatasetAttachmentStorageOptions): DatasetAttachmentStorage {
  const objects = join(directory, "objects"),
    staging = join(directory, "staging");
  let initialized: Promise<void> | undefined;
  const init = () =>
    (initialized ??= (async () => {
      await secureDirectory(directory);
      await secureDirectory(objects);
      await secureDirectory(staging);
    })());
  return {
    async stage(upload, signal) {
      await init();
      signal?.throwIfAborted();
      const temp = await mkdtemp(join(staging, "request-"));
      const input = join(temp, "source");
      try {
        const handle = await open(input, "wx", 0o600);
        const hash = createHash("sha256");
        let bytes = 0,
          header = Buffer.alloc(0);
        try {
          for await (const chunk of upload.body) {
            signal?.throwIfAborted();
            if (!(chunk instanceof Uint8Array))
              throw new DatasetAttachmentError("invalid_request");
            bytes += chunk.byteLength;
            if (bytes > DATASET_ATTACHMENT_LIMITS.fileBytes)
              throw new DatasetAttachmentError("too_large");
            hash.update(chunk);
            if (header.length < 12)
              header = Buffer.concat([
                header,
                chunk.subarray(0, 12 - header.length),
              ]);
            await handle.writeFile(chunk);
          }
          signal?.throwIfAborted();
          await handle.sync();
        } finally {
          await handle.close();
        }
        const contentType = sniff(header);
        if (!bytes || !contentType)
          throw new DatasetAttachmentError("invalid_request");
        const processed = await processor.process(
          { path: input, byteLength: bytes, contentType },
          signal,
        );
        const files: {
          path: string;
          sha256: string;
          byteLength: number;
          contentType: DatasetAttachmentMime;
        }[] = [];
        let object: DatasetAttachmentObject;
        try {
          for (const [index, artifact] of [
            processed.primary,
            ...(processed.small ? [processed.small] : []),
          ].entries()) {
            signal?.throwIfAborted();
            const verified = await inspect(artifact.path, signal);
            if (
              (index === 0 &&
                verified.byteLength > DATASET_ATTACHMENT_LIMITS.fileBytes) ||
              verified.sha256 !== artifact.sha256 ||
              verified.byteLength !== artifact.byteLength ||
              verified.contentType !== artifact.contentType
            )
              throw new DatasetAttachmentError("unavailable");
            if (
              index === 1 &&
              (artifact.contentType !== "image/webp" ||
                !processed.small ||
                !Number.isSafeInteger(processed.small.width) ||
                !Number.isSafeInteger(processed.small.height) ||
                processed.small.width < 1 ||
                processed.small.height < 1 ||
                processed.small.width > 2048 ||
                processed.small.height > 2048)
            )
              throw new DatasetAttachmentError("unavailable");
            const path = join(temp, "output-" + index);
            const source = await open(
              artifact.path,
              constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            );
            let destination: FileHandle | undefined;
            try {
              destination = await open(path, "wx", 0o600);
              let copiedBytes = 0;
              for await (const c of source.createReadStream({
                autoClose: false,
              })) {
                signal?.throwIfAborted();
                copiedBytes += c.length;
                if (
                  copiedBytes > artifact.byteLength ||
                  copiedBytes > DATASET_ATTACHMENT_LIMITS.datasetBytes
                )
                  throw new DatasetAttachmentError("too_large");
                await destination.writeFile(c);
              }
              await destination.sync();
            } finally {
              await source.close();
              await destination?.close();
            }
            const copied = await inspect(path, signal);
            if (
              copied.sha256 !== verified.sha256 ||
              copied.byteLength !== verified.byteLength
            )
              throw new DatasetAttachmentError("unavailable");
            files.push({ ...artifact, path });
          }
          const primary = files[0]!;
          const total = files.reduce((n, f) => n + f.byteLength, 0);
          if (
            total !== processed.totalBytes ||
            total > DATASET_ATTACHMENT_LIMITS.datasetBytes
          )
            throw new DatasetAttachmentError("too_large");
          const extension =
            primary.contentType === "image/jpeg"
              ? "jpg"
              : primary.contentType === "image/png"
                ? "png"
                : "webp";
          const basename = upload.filename.replace(/\.[^/.]*$/, "");
          const filename =
            Array.from(basename || "image").reduce(
              (s, c) => (s.length + c.length <= 249 ? s + c : s),
              "",
            ) +
            "." +
            extension;
          object = {
            sha256: primary.sha256,
            storageKey: primary.sha256,
            byteLength: primary.byteLength,
            contentType: primary.contentType,
            filename,
            totalBytes: total,
            ...(processed.small
              ? {
                  small: {
                    sha256: files[1]!.sha256,
                    storageKey: files[1]!.sha256,
                    byteLength: files[1]!.byteLength,
                    contentType: "image/webp" as const,
                    width: processed.small.width,
                    height: processed.small.height,
                  },
                }
              : {}),
          };
        } finally {
          await processed.dispose();
        }
        let disposed = false;
        return {
          inputSha256: hash.digest("hex"),
          object,
          async publish() {
            if (disposed) throw new DatasetAttachmentError("unavailable");
            for (const f of files) {
              signal?.throwIfAborted();
              const target = join(objects, f.sha256);
              try {
                await link(f.path, target);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                  throw error;
                const existing = await inspect(target, signal);
                if (
                  existing.sha256 !== f.sha256 ||
                  existing.byteLength !== f.byteLength
                )
                  throw new DatasetAttachmentError("unavailable");
              }
            }
            const d = await open(objects, constants.O_RDONLY);
            try {
              await d.sync();
            } finally {
              await d.close();
            }
          },
          async discard() {
            if (!disposed) {
              disposed = true;
              await rm(temp, { recursive: true, force: true });
            }
          },
        };
      } catch (error) {
        await rm(temp, { recursive: true, force: true });
        throw error;
      }
    },
    async open(object, signal) {
      await init();
      signal?.throwIfAborted();
      if (
        !/^[a-f0-9]{64}$/.test(object.storageKey) ||
        object.storageKey !== object.sha256
      )
        throw new DatasetAttachmentError("unavailable");
      const f = await open(
        join(objects, object.storageKey),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let closed = false;
      const close = async () => {
        if (!closed) {
          closed = true;
          await f.close();
        }
      };
      try {
        const s = await f.stat();
        if (!s.isFile() || s.size !== object.byteLength)
          throw new DatasetAttachmentError("unavailable");
      } catch (error) {
        await close();
        throw error;
      }
      return {
        close,
        body: (async function* () {
          try {
            for await (const c of f.createReadStream({ autoClose: false })) {
              signal?.throwIfAborted();
              yield c;
            }
          } finally {
            await close();
          }
        })(),
      };
    },
  };
}
