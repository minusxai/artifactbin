import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type {
  ImageArtifact,
  ImageManifest,
  RasterImageType,
} from "./contracts.ts";
import { IMAGE_PROCESS_LIMITS as limits } from "./contracts.ts";
import { decodeImageManifest } from "./protocol.ts";
/** Length-delimited streaming parser; only the <=8KiB manifest is assembled in memory. */
export async function readImageResponse(
  input: AsyncIterable<Uint8Array>,
  directory: string,
  inputBytes: number,
  type: RasterImageType,
  signal: AbortSignal,
): Promise<{
  manifest: ImageManifest;
  primary?: ImageArtifact;
  small?: ImageArtifact;
}> {
  const iterator = input[Symbol.asyncIterator]();
  let pending: Buffer = Buffer.alloc(0),
    total = 0;
  const next = async () => {
    signal.throwIfAborted();
    const n = await iterator.next();
    if (n.done) throw Error("image_result_truncated");
    total += n.value.length;
    if (total > limits.outputBytes) throw Error("image_output_limit");
    pending = Buffer.from(
      n.value.buffer,
      n.value.byteOffset,
      n.value.byteLength,
    );
  };
  const take = async function* (length: number) {
    while (length) {
      if (!pending.length) await next();
      const n = Math.min(length, pending.length);
      yield pending.subarray(0, n);
      pending = pending.subarray(n);
      length -= n;
    }
  };
  const collect = async (length: number) => {
    const chunks = [];
    for await (const c of take(length)) chunks.push(c);
    return Buffer.concat(chunks, length);
  };
  const length = (await collect(4)).readUInt32BE();
  if (!length || length > limits.headerBytes)
    throw Error("image_result_invalid");
  let json;
  try {
    json = JSON.parse((await collect(length)).toString());
  } catch {
    throw Error("image_result_invalid");
  }
  const manifest = decodeImageManifest(json, inputBytes, type);
  const artifact = async (
    name: string,
    byteLength: number,
    contentType: RasterImageType,
  ) => {
    const path = join(directory, name),
      file = await open(path, "wx", 0o600),
      hash = createHash("sha256");
    let prefix = Buffer.alloc(0);
    try {
      for await (const chunk of take(byteLength)) {
        if (prefix.length < 12)
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 12 - prefix.length),
          ]);
        hash.update(chunk);
        await file.writeFile(chunk);
      }
    } finally {
      await file.close();
    }
    if (
      prefix.subarray(0, 4).toString() !== "RIFF" ||
      prefix.subarray(8, 12).toString() !== "WEBP"
    )
      throw Error("image_result_invalid");
    return { path, byteLength, contentType, sha256: hash.digest("hex") };
  };
  const primary =
    manifest.primary.source === "encoded"
      ? await artifact(
          "primary.webp",
          manifest.primary.byteLength,
          "image/webp",
        )
      : undefined;
  const small = manifest.small
    ? await artifact("small.webp", manifest.small.byteLength, "image/webp")
    : undefined;
  if (pending.length) throw Error("image_result_trailing");
  const end = await iterator.next();
  if (!end.done) throw Error("image_result_trailing");
  return {
    manifest,
    ...(primary ? { primary } : {}),
    ...(small ? { small } : {}),
  };
}
