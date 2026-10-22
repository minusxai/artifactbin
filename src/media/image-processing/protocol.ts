import { IMAGE_PROCESS_LIMITS as limits } from "./contracts.ts";
import type { ImageManifest, RasterImageType } from "./contracts.ts";
export function imageHeader(value: unknown): Buffer {
  const text = Buffer.from(JSON.stringify(value));
  if (text.length > limits.headerBytes) throw Error("image_result_invalid");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(text.length);
  return Buffer.concat([size, text]);
}
const keys = (v: any, names: string[]) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === names.sort().join();
const size = (n: unknown, max: number) =>
  Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= max;
/** Validate untrusted controller output before creating any generated file or accepting byte counts. */
export function decodeImageManifest(
  value: unknown,
  inputBytes: number,
  sourceType: RasterImageType,
): ImageManifest {
  const v = value as any;
  if (
    keys(v, ["error"]) &&
    [
      "image_type",
      "image_input_limit",
      "image_pixel_limit",
      "image_processing_failed",
    ].includes(v.error)
  )
    throw Error(v.error);
  if (
    !keys(v, ["version", "sourceType", "primary", "small", "placeholder"]) ||
    v.version !== "image-process-v1" ||
    v.sourceType !== sourceType ||
    !keys(v.primary, ["source", "byteLength", "contentType", "width", "height"])
  )
    throw Error("image_result_invalid");
  const p = v.primary;
  const dimensions = (w: unknown, h: unknown) =>
    size(w, limits.dimension) &&
    size(h, limits.dimension) &&
    (w as number) * (h as number) <= limits.pixels;
  if (p.source === "input") {
    if (
      p.byteLength !== inputBytes ||
      p.contentType !== sourceType ||
      !(
        (p.width === null && p.height === null) ||
        dimensions(p.width, p.height)
      )
    )
      throw Error("image_result_invalid");
  } else if (p.source === "encoded") {
    if (
      !size(p.byteLength, inputBytes - 1) ||
      p.contentType !== "image/webp" ||
      !dimensions(p.width, p.height) ||
      Math.max(p.width, p.height) > 2048
    )
      throw Error("image_result_invalid");
  } else throw Error("image_result_invalid");
  if (
    v.small !== null &&
    (!keys(v.small, ["byteLength", "width", "height"]) ||
      !size(v.small.byteLength, p.byteLength - 1) ||
      !dimensions(v.small.width, v.small.height) ||
      v.small.width > 1280)
  )
    throw Error("image_result_invalid");
  if (
    v.placeholder !== null &&
    (typeof v.placeholder !== "string" ||
      v.placeholder.length > 5600 ||
      !/^data:image\/webp;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        v.placeholder,
      ))
  )
    throw Error("image_result_invalid");
  return v as ImageManifest;
}
