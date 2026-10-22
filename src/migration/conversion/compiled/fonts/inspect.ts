import type { InspectedFont } from "./contracts.ts";
/** Bounded metadata inspection after offline WOFF2 expansion. Never executes font bytecode. */
export function inspectSfnt(input: Uint8Array): InspectedFont {
  const bytes = Buffer.from(input);
  if (
    bytes.length < 12 ||
    bytes.length > 4_000_000 ||
    ![0x10000, 0x4f54544f].includes(bytes.readUInt32BE(0))
  )
    throw Error("Unsupported font container");
  const count = bytes.readUInt16BE(4);
  if (!count || count > 256 || 12 + count * 16 > bytes.length)
    throw Error("Invalid font directory");
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16,
      tag = bytes.toString("ascii", p, p + 4),
      offset = bytes.readUInt32BE(p + 8),
      length = bytes.readUInt32BE(p + 12);
    if (
      tables.has(tag) ||
      offset < 12 + count * 16 ||
      length > bytes.length - offset
    )
      throw Error("Invalid font table bounds");
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  const os = tables.get("OS/2"),
    names = tables.get("name");
  if (!os || os.length < 64 || !names || names.length < 6)
    throw Error("Font identity metadata unavailable");
  const nameCount = names.readUInt16BE(2),
    strings = names.readUInt16BE(4);
  if (
    nameCount > 4096 ||
    6 + nameCount * 12 > names.length ||
    strings < 6 + nameCount * 12 ||
    strings > names.length
  )
    throw Error("Invalid font names");
  const families = new Set<string>();
  for (let i = 0; i < nameCount; i++) {
    const p = 6 + i * 12,
      platform = names.readUInt16BE(p),
      kind = names.readUInt16BE(p + 6),
      length = names.readUInt16BE(p + 8),
      offset = names.readUInt16BE(p + 10);
    if (![1, 16].includes(kind) || ![0, 3].includes(platform)) continue;
    if (length > 512 || length % 2 || strings + offset > names.length - length)
      throw Error("Invalid font family bounds");
    const value = Buffer.from(
      names.subarray(strings + offset, strings + offset + length),
    )
      .swap16()
      .toString("utf16le");
    if (!value || /[\u0000-\u001f\u007f]/.test(value))
      throw Error("Invalid font family");
    families.add(value);
  }
  if (!families.size) throw Error("Font family metadata unavailable");
  const axes: InspectedFont["axes"][number][] = [],
    fvar = tables.get("fvar");
  if (fvar) {
    if (fvar.length < 16) throw Error("Invalid font variation header");
    const offset = fvar.readUInt16BE(4),
      count = fvar.readUInt16BE(8),
      size = fvar.readUInt16BE(10);
    if (
      count > 16 ||
      size < 20 ||
      offset < 16 ||
      offset + count * size > fvar.length
    )
      throw Error("Invalid font variation bounds");
    for (let i = 0; i < count; i++) {
      const p = offset + i * size,
        tag = fvar.toString("ascii", p, p + 4),
        min = fvar.readInt32BE(p + 4) / 65536,
        value = fvar.readInt32BE(p + 8) / 65536,
        max = fvar.readInt32BE(p + 12) / 65536;
      if (
        !/^[a-z]{4}$/.test(tag) ||
        axes.some((axis) => axis.tag === tag) ||
        min > value ||
        value > max
      )
        throw Error("Invalid font variation axis");
      axes.push({ tag, min, default: value, max });
    }
  }
  const weight = os.readUInt16BE(4);
  if (weight < 1 || weight > 1000) throw Error("Invalid font weight");
  return {
    families: [...families],
    axes,
    weight,
    style: os.readUInt16BE(62) & 1 ? "italic" : "normal",
  };
}
