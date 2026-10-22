import { IMAGE_PROCESS_LIMITS as limits } from "./contracts.ts";
import type {
  RasterImageType,
  RasterDecoder,
  RasterResult,
  RasterMetadata,
} from "./contracts.ts";
/** Header check only, not an image decoder. The sandbox separately corroborates the selected native loader. */
export function rasterType(bytes: Uint8Array): RasterImageType | null {
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
/** Frozen optimisation policy, injected decoder runs exclusively in the resource-limited image container. */
export async function optimiseRaster(
  input: Buffer,
  decoder: RasterDecoder,
): Promise<RasterResult> {
  if (!input.length || input.length > limits.inputBytes)
    throw Error("image_input_limit");
  const type = rasterType(input);
  if (!type) throw Error("image_type");
  const result: RasterResult = {
    manifest: {
      version: "image-process-v1",
      sourceType: type,
      primary: {
        source: "input",
        byteLength: input.length,
        contentType: type,
        width: null,
        height: null,
      },
      small: null,
      placeholder: null,
    },
    primary: null,
    small: null,
  };
  let metadata: RasterMetadata;
  try {
    metadata = await decoder.metadata(input);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "image_decode_failed")
      throw error;
    return result;
  }
  const { width, height, pages } = metadata;
  if (!width || !height) return result;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > limits.dimension ||
    height > limits.dimension ||
    width * height > limits.pixels
  )
    throw Error("image_pixel_limit");
  const base = {
    ...result,
    manifest: {
      ...result.manifest,
      primary: { ...result.manifest.primary, width, height },
    },
  };
  if (pages > 1) return base;
  let encoded;
  try {
    encoded = await decoder.encode(
      input,
      type === "image/png" ? "primary-png" : "primary-lossy",
    );
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "image_decode_failed")
      throw error;
    return base;
  }
  const smaller = encoded.bytes.length < input.length;
  const primary = smaller ? encoded.bytes : null;
  const manifest = {
    ...base.manifest,
    primary: smaller
      ? {
          source: "encoded" as const,
          byteLength: encoded.bytes.length,
          contentType: "image/webp" as const,
          width: encoded.width,
          height: encoded.height,
        }
      : base.manifest.primary,
  };
  try {
    const tiny = await decoder.encode(input, "placeholder");
    if (tiny.bytes.length <= 4096)
      manifest.placeholder = `data:image/webp;base64,${Buffer.from(tiny.bytes).toString("base64")}`;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "image_decode_failed")
      throw error;
  }
  let small = null;
  if (width > 1536) {
    try {
      const candidate = await decoder.encode(input, "small");
      if (candidate.bytes.length < manifest.primary.byteLength) {
        small = candidate.bytes;
        manifest.small = {
          byteLength: small.length,
          width: candidate.width,
          height: candidate.height,
        };
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "image_decode_failed")
        throw error;
    }
  }
  return { manifest, primary, small };
}
