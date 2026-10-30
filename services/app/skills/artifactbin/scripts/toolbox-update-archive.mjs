/** Internal: verify release archives without executing contents. Used by toolbox-update.mjs. */
import { createHash } from "node:crypto";
export const limit = 32 * 1024 * 1024;
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const member = new RegExp(
  '^(?:SKILL\\.md|release\\.json|references/[a-z0-9-]+\\.md|' +
  'scripts/[a-z0-9-]+\\.mjs|examples/[a-z0-9-]+\\.(?:html|csv|ts|mjs)|' +
  'design-systems/[a-z0-9-]+\\.css|components/[a-z0-9-]+\\.ts)$'
);
export function decodeRelease(bytes, manifest) {
  if (bytes.length > limit || !hex(manifest.sha256) || hash(bytes) !== manifest.sha256)
    throw Error("Invalid archive checksum or size");
  const files = Object.create(null);
  let offset = 0;
  const entries = [];
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6),
      method = bytes.readUInt16LE(offset + 8),
      size = bytes.readUInt32LE(offset + 18),
      plain = bytes.readUInt32LE(offset + 22),
      n = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + n + extra,
      end = start + size;
    if (flags !== 0x800 || method !== 0 || size !== plain || extra || end > bytes.length)
      throw Error("Unsupported archive");
    const full = bytes.subarray(offset + 30, offset + 30 + n).toString("utf8"),
      name = full.slice(12);
    if (!full.startsWith("artifactbin/") || !member.test(name) || name in files)
      throw Error("Unsafe archive member");
    const data = bytes.subarray(start, end);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== bytes.readUInt32LE(offset + 14))
      throw Error("Corrupt archive member");
    entries.push({ offset, full, size, crc: (crc ^ 0xffffffff) >>> 0 });
    files[name] = data.toString("utf8");
    offset = end;
  }
  const central = offset;
  for (const entry of entries) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw Error("Invalid directory");
    const n = bytes.readUInt16LE(offset + 28);
    if (
      bytes.readUInt16LE(offset + 30) ||
      bytes.readUInt16LE(offset + 32) ||
      bytes.readUInt32LE(offset + 38) ||
      bytes.readUInt32LE(offset + 42) !== entry.offset ||
      bytes.readUInt32LE(offset + 16) !== entry.crc ||
      bytes.readUInt32LE(offset + 20) !== entry.size ||
      bytes.subarray(offset + 46, offset + 46 + n).toString() !== entry.full
    )
      throw Error("Invalid directory entry");
    offset += 46 + n;
  }
  if (
    offset + 22 !== bytes.length ||
    bytes.readUInt32LE(offset) !== 0x06054b50 ||
    bytes.readUInt32LE(offset + 16) !== central ||
    bytes.readUInt32LE(offset + 12) !== offset - central ||
    bytes.readUInt16LE(offset + 10) !== entries.length
  )
    throw Error("Invalid archive end");
  const release = JSON.parse(files["release.json"]);
  delete files["release.json"];
  if (
    !hex(manifest.version) ||
    release.schemaVersion !== 1 ||
    release.origin !== manifest.origin ||
    release.version !== manifest.version ||
    hash(
      JSON.stringify([
        manifest.origin,
        Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    ) !== manifest.version ||
    !files["SKILL.md"]
  )
    throw Error("Invalid release identity");
  files["release.json"] = JSON.stringify(release) + "\n";
  return files;
}
