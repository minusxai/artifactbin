// Only this fixed sandbox entry loads a native decoder. No filenames, URLs, options or code arrive on stdin.
import sharp from "sharp";
import { optimiseRaster, rasterType } from "../engine.ts";
import { imageHeader } from "../protocol.ts";
import { IMAGE_PROCESS_LIMITS as limits } from "../contracts.ts";
sharp.cache(false);
sharp.concurrency(1);
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({
  operation: [
    "VipsForeignLoadPngBuffer",
    "VipsForeignLoadJpegBuffer",
    "VipsForeignLoadWebpBuffer",
  ],
});
const inputOptions = {
  limitInputPixels: limits.pixels,
  limitInputChannels: 5,
  pages: 1,
  failOn: "warning",
  sequentialRead: true,
};
const load = (bytes) => sharp(bytes, inputOptions);
function decodeError(error) {
  const message = String(error);
  if (/pixel limit/i.test(message)) return Error("image_pixel_limit");
  // Only known malformed/unsupported decoder failures retain the frozen passthrough behavior.
  if (
    /unsupported image format|corrupt|invalid|premature|unexpected end|bad (?:header|image)|not a known|not enough data|read error|pngload|jpegload|webpload/i.test(
      message,
    ) &&
    !/memory|allocation|resource|timeout/i.test(message)
  )
    return Error("image_decode_failed");
  return Error("image_processing_failed");
}
async function run() {
  let count = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    count += chunk.length;
    if (count > limits.inputBytes) throw Error("image_input_limit");
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks, count);
  chunks.length = 0;
  const result = await optimiseRaster(input, {
    async metadata(bytes) {
      let m;
      try {
        m = await load(bytes).metadata();
      } catch (error) {
        throw decodeError(error);
      }
      const expected = {
        "image/png": "png",
        "image/jpeg": "jpeg",
        "image/webp": "webp",
      }[rasterType(bytes)];
      if (m.format !== expected) throw Error("image_type");
      return {
        width: m.width ?? 0,
        height: m.height ?? 0,
        pages: m.pages ?? 1,
      };
    },
    async encode(bytes, operation) {
      let pipeline = load(bytes).rotate();
      if (operation === "small")
        pipeline = pipeline
          .resize({ width: 1280, withoutEnlargement: true })
          .webp({ quality: 78, effort: 4 });
      else if (operation === "placeholder")
        pipeline = pipeline
          .resize({ width: 16, height: 16, fit: "inside" })
          .webp({ quality: 40 });
      else
        pipeline = pipeline
          .resize({
            width: 2048,
            height: 2048,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp(
            operation === "primary-png"
              ? { lossless: true, effort: 4 }
              : { quality: 78, effort: 4 },
          );
      let out;
      try {
        out = await pipeline.toBuffer({ resolveWithObject: true });
      } catch (error) {
        throw decodeError(error);
      }
      return {
        bytes: out.data,
        width: out.info.width,
        height: out.info.height,
      };
    },
  });
  process.stdout.write(imageHeader(result.manifest));
  if (result.primary) process.stdout.write(result.primary);
  if (result.small) process.stdout.write(result.small);
}
run().catch((error) => {
  const code = [
    "image_input_limit",
    "image_pixel_limit",
    "image_type",
  ].includes(error?.message)
    ? error.message
    : "image_processing_failed";
  process.stdout.write(imageHeader({ error: code }));
});
