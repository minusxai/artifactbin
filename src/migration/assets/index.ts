import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, open, link, unlink, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
export interface AssetSnapshot {
  readonly artifactId: string;
  readonly version: number;
  readonly format: "image" | "file" | "pdf";
  readonly meta: Readonly<Record<string, unknown>>;
}
export interface AssetReference {
  readonly artifactId: string;
  readonly version: number;
  readonly variant: "original" | "small";
  readonly filename?: string;
  readonly width?: number;
  readonly height?: number;
  /** Upload digest is provenance, never verification of optimized image bytes. */
  readonly uploadedSha256?: string;
}
export interface AssetObject {
  readonly objectKey: string;
  readonly contentType: string;
  readonly expectedBytes?: number;
  readonly references: readonly AssetReference[];
}
export interface AssetPlan {
  readonly objects: readonly AssetObject[];
}
export interface ObjectReader {
  read(objectKey: string): Promise<AsyncIterable<Uint8Array>>;
}
export type AssetReceipt = {
  readonly objectKey: string;
} & (
  | {
      readonly status: "copied";
      readonly path: string;
      readonly bytes: number;
      readonly sha256: string;
    }
  | {
      readonly status: "failed";
      readonly reason:
        | "unavailable"
        | "invalid_bytes"
        | "size_mismatch"
        | "digest_mismatch"
        | "write_failed";
    }
);
/** Only legacy content-addressed object keys are admitted; never URLs or paths. */
function validKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !/^(image|file|pdf)\/[a-f0-9]{32}$/.test(key))
    throw new Error("Invalid immutable asset key");
}
function size(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid asset size");
  return value;
}
function dimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}
export function planAssets(snapshots: readonly AssetSnapshot[]): AssetPlan {
  const objects = new Map<
    string,
    {
      objectKey: string;
      contentType: string;
      expectedBytes?: number;
      references: AssetReference[];
    }
  >();
  for (const snapshot of snapshots) {
    const { meta, format } = snapshot;
    if (
      !["image", "file", "pdf"].includes(format) ||
      !snapshot.artifactId ||
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.version < 1
    )
      throw new Error("Invalid asset snapshot");
    validKey(meta.objectKey);
    if (!meta.objectKey.startsWith(`${format}/`))
      throw new Error("Asset key format mismatch");
    const variants: ("original" | "small")[] = ["original"];
    if (meta.smallObjectKey !== undefined) {
      if (format !== "image") throw new Error("Unexpected asset variant");
      validKey(meta.smallObjectKey);
      if (!meta.smallObjectKey.startsWith("image/"))
        throw new Error("Asset variant format mismatch");
      variants.push("small");
    }
    const bytes = size(meta.bytes);
    for (const variant of variants) {
      const key = (
        variant === "small" ? meta.smallObjectKey : meta.objectKey
      ) as string;
      const contentType =
        variant === "small"
          ? "image/webp"
          : typeof meta.contentType === "string"
            ? meta.contentType
            : format === "pdf"
              ? "application/pdf"
              : "application/octet-stream";
      const expectedBytes =
        variant === "original" && meta.smallObjectKey === undefined
          ? bytes
          : undefined;
      const reference: AssetReference = Object.freeze({
        artifactId: snapshot.artifactId,
        version: snapshot.version,
        variant,
        ...(typeof meta.filename === "string"
          ? { filename: meta.filename }
          : {}),
        ...(typeof meta.sha256 === "string"
          ? { uploadedSha256: meta.sha256 }
          : {}),
        ...(dimension(variant === "small" ? meta.smallWidth : meta.width) !==
        undefined
          ? {
              width: dimension(
                variant === "small" ? meta.smallWidth : meta.width,
              ),
            }
          : {}),
        ...(variant === "original" && dimension(meta.height) !== undefined
          ? { height: dimension(meta.height) }
          : {}),
      });
      const prior = objects.get(key);
      if (prior) {
        if (
          prior.contentType !== contentType ||
          (prior.expectedBytes !== undefined &&
            expectedBytes !== undefined &&
            prior.expectedBytes !== expectedBytes)
        )
          throw new Error("Conflicting asset metadata");
        if (expectedBytes !== undefined) prior.expectedBytes = expectedBytes;
        prior.references.push(reference);
      } else
        objects.set(key, {
          objectKey: key,
          contentType,
          ...(expectedBytes !== undefined ? { expectedBytes } : {}),
          references: [reference],
        });
    }
  }
  return Object.freeze({
    objects: Object.freeze(
      [...objects.values()].map((object) =>
        Object.freeze({
          ...object,
          references: Object.freeze(object.references),
        }),
      ),
    ),
  });
}

/** Copies only planned immutable keys. The destination must be a trusted private migration directory. */
export async function extractAssets(
  plan: AssetPlan,
  reader: ObjectReader,
  directory: string,
): Promise<readonly AssetReceipt[]> {
  // Validate the entire plan before any source read or filesystem mutation.
  const keys = new Set<string>();
  for (const object of plan.objects) {
    validKey(object.objectKey);
    size(object.expectedBytes);
    if (keys.has(object.objectKey))
      throw new Error("Duplicate asset key in plan");
    keys.add(object.objectKey);
  }
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Invalid private destination");
  await chmod(root, 0o700);
  const receipts: AssetReceipt[] = [];
  for (const object of plan.objects) {
    const path = join(root, object.objectKey.replace("/", "-"));
    const temporary = join(root, `.partial-${randomUUID()}`);
    let reason: Extract<AssetReceipt, { status: "failed" }>["reason"] =
      "unavailable";
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const source = await reader.read(object.objectKey);
      reason = "write_failed";
      file = await open(temporary, "wx", 0o600);
      const hash = createHash("sha256");
      let bytes = 0;
      reason = "unavailable";
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) {
          reason = "invalid_bytes";
          throw new Error();
        }
        bytes += chunk.byteLength;
        if (
          !Number.isSafeInteger(bytes) ||
          (object.expectedBytes !== undefined && bytes > object.expectedBytes)
        ) {
          reason = "size_mismatch";
          throw new Error();
        }
        hash.update(chunk);
        reason = "write_failed";
        let offset = 0;
        while (offset < chunk.byteLength) {
          const written = await file.write(
            chunk,
            offset,
            chunk.byteLength - offset,
          );
          if (written.bytesWritten === 0) throw new Error();
          offset += written.bytesWritten;
        }
        reason = "unavailable";
      }
      if (
        object.expectedBytes !== undefined &&
        bytes !== object.expectedBytes
      ) {
        reason = "size_mismatch";
        throw new Error();
      }
      const sha256 = hash.digest("hex");
      if (!sha256.startsWith(object.objectKey.split("/")[1]!)) {
        reason = "digest_mismatch";
        throw new Error();
      }
      reason = "write_failed";
      await file.sync();
      await file.close();
      file = undefined;
      // link is exclusive: a prior extraction is never overwritten.
      await link(temporary, path);
      receipts.push(
        Object.freeze({
          objectKey: object.objectKey,
          status: "copied",
          path,
          bytes,
          sha256,
        }),
      );
    } catch {
      receipts.push(
        Object.freeze({
          objectKey: object.objectKey,
          status: "failed",
          reason,
        }),
      );
    } finally {
      await file?.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
  return Object.freeze(receipts);
}
