import { MAX_FONT_BYTES } from "./contracts.ts";
/** Bounds both original SFNT tables and the Brotli-transformed stream before decoding. */
export function validateWoff2Bounds(input: Uint8Array): void {
  const bytes = Buffer.from(input),
    max = 4_000_000;
  if (
    bytes.length < 50 ||
    bytes.length > MAX_FONT_BYTES ||
    bytes.toString("ascii", 0, 4) !== "wOF2" ||
    ![0x10000, 0x4f54544f].includes(bytes.readUInt32BE(4)) ||
    bytes.readUInt32BE(8) !== bytes.length ||
    bytes.readUInt16BE(14) !== 0 ||
    bytes.readUInt32BE(16) > max
  )
    throw Error("WOFF2 container bounds refused");
  const count = bytes.readUInt16BE(12);
  if (!count || count > 256) throw Error("WOFF2 table count refused");
  let offset = 48,
    original = 12 + count * 16,
    transformed = 0;
  const length = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (offset >= bytes.length) throw Error("WOFF2 directory truncated");
      const next = bytes[offset++]!;
      if (i === 0 && next === 0x80)
        throw Error("WOFF2 length encoding refused");
      value = value * 128 + (next & 127);
      if (value > max) throw Error("WOFF2 table size refused");
      if (!(next & 128)) return value;
    }
    throw Error("WOFF2 length encoding refused");
  };
  for (let i = 0; i < count; i++) {
    if (offset >= bytes.length) throw Error("WOFF2 directory truncated");
    const flags = bytes[offset++]!,
      index = flags & 63,
      version = flags >>> 6;
    let tag =
      index === 10 ? "glyf" : index === 11 ? "loca" : index === 3 ? "hmtx" : "";
    if (index === 63) {
      if (offset + 4 > bytes.length) throw Error("WOFF2 tag truncated");
      tag = bytes.toString("ascii", offset, offset + 4);
      offset += 4;
    }
    const size = length();
    let altered = false;
    if (tag === "glyf" || tag === "loca") {
      if (version !== 0 && version !== 3)
        throw Error("WOFF2 transformation refused");
      altered = version === 0;
    } else if (version !== 0) {
      if (tag !== "hmtx" || version !== 1)
        throw Error("WOFF2 transformation refused");
      altered = true;
    }
    const transformedSize = altered ? length() : size;
    if (tag === "loca" && altered && transformedSize !== 0)
      throw Error("WOFF2 loca transformation refused");
    original += (size + 3) & ~3;
    transformed += transformedSize;
    if (original > max || transformed > max)
      throw Error("WOFF2 expansion limit");
  }
  const compressed = bytes.readUInt32BE(20);
  if (
    !compressed ||
    compressed > bytes.length - offset ||
    original > bytes.readUInt32BE(16)
  )
    throw Error("WOFF2 compressed span refused");
}
