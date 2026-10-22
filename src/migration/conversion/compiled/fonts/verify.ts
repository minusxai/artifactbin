import { validateWoff2Bounds } from "./woff2.ts";
import { constants } from "node:fs";
import { open, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { admitCapturedFontCss, capturedFontOmissions } from "./capture-css.ts";
import { FONT_CAPTURE_LIMITS as limits } from "./capture-contracts.ts";
import type {
  CapturedFontBundleInput,
  CapturedFontManifest,
} from "./capture-contracts.ts";
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
async function readBounded(
  root: string,
  relative: string,
  max: number,
): Promise<Uint8Array> {
  const file = path.join(root, relative);
  const resolved = await realpath(file);
  if (!resolved.startsWith(root + path.sep))
    throw Error("Font bundle file escapes directory");
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max)
      throw Error("Font bundle file limit");
    const out = Buffer.alloc(max + 1);
    let length = 0;
    while (length <= max) {
      const result = await handle.read(
        out,
        length,
        out.length - length,
        length,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > max) throw Error("Font bundle file limit");
    return out.subarray(0, length);
  } finally {
    await handle.close();
  }
}
export interface VerifiedFontBundle {
  readonly manifest: CapturedFontManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Hash over manifest bytes and every verified stylesheet/font byte digest. */
  readonly resourceDigest: string;
}
/** Replay immutable receipts without any network or authored code execution. */
export async function verifyCapturedFontBundle(
  input: CapturedFontBundleInput,
): Promise<VerifiedFontBundle> {
  return verify(input, true);
}
async function verify(
  input: CapturedFontBundleInput,
  allowSet: boolean,
): Promise<VerifiedFontBundle> {
  if (
    !input ||
    typeof input.directory !== "string" ||
    !sha(input.manifestSha256)
  )
    throw Error("Font bundle input refused");
  const root = await realpath(input.directory),
    manifestBytes = await readBounded(root, "manifest.json", 1_000_000);
  if (digest(manifestBytes) !== input.manifestSha256)
    throw Error("Font bundle manifest hash mismatch");
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
  ) as CapturedFontManifest;
  if ((manifest as any)?.kind === "font-bundle-set") {
    const set =
      manifest as unknown as import("./capture-contracts.ts").CapturedFontBundleSetManifest;
    if (
      !allowSet ||
      set.version !== 1 ||
      !Array.isArray(set.bundles) ||
      !set.bundles.length ||
      set.bundles.length > 8
    )
      throw Error("Font bundle set refused");
    const directories = new Set<string>(),
      sheets = new Map<string, CapturedFontManifest["stylesheets"][number]>(),
      files = new Map<string, Uint8Array>(),
      closure: string[] = [input.manifestSha256];
    for (const child of set.bundles) {
      if (
        !child ||
        !/^bundle-[0-7]$/.test(child.directory) ||
        directories.has(child.directory) ||
        !sha(child.manifestSha256) ||
        !sha(child.resourceDigest)
      )
        throw Error("Font bundle set child refused");
      directories.add(child.directory);
      const directory = path.join(root, child.directory),
        stat = await lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await realpath(directory)) !== directory
      )
        throw Error("Font bundle set containment refused");
      const verified = await verify(
        { directory, manifestSha256: child.manifestSha256 },
        false,
      );
      if (verified.resourceDigest !== child.resourceDigest)
        throw Error("Font bundle set resource mismatch");
      closure.push(
        child.directory +
          ":" +
          child.manifestSha256 +
          ":" +
          verified.resourceDigest,
      );
      for (const sheet of verified.manifest.stylesheets) {
        const old = sheets.get(sheet.requestSha256);
        if (old && JSON.stringify(old) !== JSON.stringify(sheet))
          throw Error("Conflicting captured font request");
        sheets.set(sheet.requestSha256, sheet);
      }
      for (const [name, bytes] of verified.files) files.set(name, bytes);
    }
    return {
      manifest: {
        version: 1,
        capturedAt: "1970-01-01T00:00:00.000Z",
        stylesheets: [...sheets.values()],
      },
      files,
      resourceDigest: digest(JSON.stringify(closure)),
    };
  }
  if (
    manifest?.version !== 1 ||
    typeof manifest.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.capturedAt)) ||
    !Array.isArray(manifest.stylesheets) ||
    !manifest.stylesheets.length ||
    manifest.stylesheets.length > limits.stylesheets
  )
    throw Error("Font bundle manifest refused");
  const files = new Map<string, Uint8Array>(),
    requests = new Set<string>();
  let count = 0,
    total = 0;
  for (const sheet of manifest.stylesheets) {
    if (
      !sheet ||
      typeof sheet.requestUrl !== "string" ||
      !sha(sheet.requestSha256) ||
      digest(sheet.requestUrl) !== sheet.requestSha256 ||
      requests.has(sheet.requestSha256) ||
      !sha(sheet.stylesheetSha256) ||
      !Number.isSafeInteger(sheet.stylesheetBytes) ||
      sheet.stylesheetBytes < 1 ||
      sheet.stylesheetBytes > limits.stylesheetBytes ||
      !Array.isArray(sheet.faces)
    )
      throw Error("Font bundle stylesheet receipt refused");
    requests.add(sheet.requestSha256);
    const cssPath = "stylesheets/" + sheet.stylesheetSha256 + ".css",
      cssBytes = await readBounded(root, cssPath, limits.stylesheetBytes);
    if (
      cssBytes.byteLength !== sheet.stylesheetBytes ||
      digest(cssBytes) !== sheet.stylesheetSha256
    )
      throw Error("Font bundle stylesheet hash mismatch");
    const descriptors = admitCapturedFontCss(
      new TextDecoder("utf-8", { fatal: true }).decode(cssBytes),
      sheet.requestUrl,
    );
    if (
      JSON.stringify(capturedFontOmissions(descriptors, sheet.requestUrl)) !==
      JSON.stringify(sheet.omittedRequests ?? [])
    )
      throw Error("Font bundle omission receipt mismatch");
    if (descriptors.length !== sheet.faces.length)
      throw Error("Font bundle descriptor count mismatch");
    files.set(cssPath, cssBytes);
    for (let index = 0; index < descriptors.length; index++) {
      const face = sheet.faces[index],
        expected = descriptors[index]!;
      if (
        !face ||
        !sha(face.sha256) ||
        !Number.isSafeInteger(face.bytes) ||
        face.bytes < 48 ||
        face.bytes > limits.fontBytes ||
        ++count > limits.faces ||
        (total += face.bytes) > limits.totalFontBytes ||
        face.family !== expected.family ||
        face.style !== expected.style ||
        JSON.stringify(face.weight) !== JSON.stringify(expected.weight) ||
        JSON.stringify(face.stretch) !== JSON.stringify(expected.stretch) ||
        face.unicodeRange !== expected.unicodeRange ||
        face.sourceUrl !== expected.sourceUrl
      )
        throw Error("Font bundle descriptor mismatch");
      const fontPath = "fonts/" + face.sha256 + ".woff2",
        bytes = await readBounded(root, fontPath, limits.fontBytes),
        view = Buffer.from(bytes);
      if (
        bytes.byteLength !== face.bytes ||
        digest(bytes) !== face.sha256 ||
        view.toString("ascii", 0, 4) !== "wOF2" ||
        view.readUInt32BE(8) !== bytes.byteLength ||
        view.readUInt32BE(16) > limits.expandedFontBytes
      )
        throw Error("Font bundle bytes mismatch");
      validateWoff2Bounds(bytes);
      files.set(fontPath, bytes);
    }
  }
  const closure = [
    input.manifestSha256,
    ...[...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, bytes]) => name + ":" + digest(bytes)),
  ];
  return { manifest, files, resourceDigest: digest(JSON.stringify(closure)) };
}
