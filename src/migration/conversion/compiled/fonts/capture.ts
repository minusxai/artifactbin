import { validateWoff2Bounds } from "./woff2.ts";
import { createHash } from "node:crypto";
import { admitCapturedFontCss, capturedFontOmissions } from "./capture-css.ts";
import { fontCaptureAddress } from "./capture-policy.ts";
import { parsePinnedFontRequest } from "./inline.ts";
import { FONT_CAPTURE_LIMITS as limits } from "./capture-contracts.ts";
import type {
  CapturedFontManifest,
  CapturedFontFaceReceipt,
} from "./capture-contracts.ts";
import type { InspectedFont } from "./contracts.ts";
export interface FontCapturePorts {
  fetch: (
    url: string,
    kind: "stylesheet" | "font",
    options: { signal: AbortSignal; maxBytes: number },
  ) => Promise<Uint8Array>;
  /** Must retire its subprocess before settling, including cancellation. */
  inspect: (bytes: Uint8Array, signal: AbortSignal) => Promise<InspectedFont>;
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
}
export interface CapturedFontJob {
  manifest: CapturedFontManifest;
  files: ReadonlyMap<string, Uint8Array>;
}
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
/** Owns one overall deadline and one all-or-nothing resource budget; performs no writes. */
export async function captureFontJob(
  urls: readonly string[],
  ports: FontCapturePorts,
  outerSignal?: AbortSignal,
): Promise<CapturedFontJob> {
  if (
    !urls.length ||
    urls.length > limits.stylesheets ||
    new Set(urls).size !== urls.length
  )
    throw Error("Font capture request limit");
  urls.forEach((url) => fontCaptureAddress(url, "stylesheet"));
  const controller = new AbortController(),
    signal = outerSignal
      ? AbortSignal.any([controller.signal, outerSignal])
      : controller.signal;
  const started = ports.now(),
    cancel = ports.schedule(() => controller.abort(), limits.deadlineMs);
  const files = new Map<string, Uint8Array>(),
    stylesheets: CapturedFontManifest["stylesheets"][number][] = [];
  let total = 0,
    count = 0;
  const check = () => {
    if (signal.aborted || ports.now() - started >= limits.deadlineMs)
      throw Error("Font capture deadline exceeded");
  };
  const bounded = async <T>(call: () => Promise<T>): Promise<T> => {
    check();
    let onAbort = () => {};
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => reject(Error("Font capture cancelled"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try {
      return await Promise.race([
        abort,
        Promise.resolve().then(() => {
          check();
          return call();
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
      check();
    }
  };
  try {
    for (const requestUrl of urls) {
      const cssBytes = await bounded(() =>
        ports.fetch(requestUrl, "stylesheet", {
          signal,
          maxBytes: limits.stylesheetBytes,
        }),
      );
      if (cssBytes.byteLength > limits.stylesheetBytes)
        throw Error("Font capture stylesheet byte limit");
      const css = new TextDecoder("utf-8", { fatal: true }).decode(cssBytes),
        descriptors = admitCapturedFontCss(css, requestUrl),
        request = parsePinnedFontRequest(requestUrl);
      const faces: CapturedFontFaceReceipt[] = [];
      for (const face of descriptors) {
        if (++count > limits.faces) throw Error("Font capture face limit");
        const bytes = await bounded(() =>
            ports.fetch(face.sourceUrl, "font", {
              signal,
              maxBytes: limits.fontBytes,
            }),
          ),
          view = Buffer.from(bytes);
        if (
          bytes.byteLength < 48 ||
          bytes.byteLength > limits.fontBytes ||
          (total += bytes.byteLength) > limits.totalFontBytes ||
          view.toString("ascii", 0, 4) !== "wOF2" ||
          view.readUInt32BE(8) !== bytes.byteLength ||
          view.readUInt32BE(16) > limits.expandedFontBytes
        )
          throw Error("Font capture container limit");
        validateWoff2Bounds(bytes);
        check();
        const inspected = await ports.inspect(bytes, signal);
        check();
        if (
          !inspected.families.some(
            (name) =>
              name === face.family || name.startsWith(face.family + " "),
          ) ||
          inspected.style !== face.style
        )
          throw Error("Captured font identity mismatch");
        const requested = request.families.find(
          (f) =>
            f.family === face.family &&
            face.style ===
              (f.axes.find((a) => a.tag === "ital")?.min === 1
                ? "italic"
                : "normal") &&
            f.axes.find((a) => a.tag === "wght")?.min === face.weight[0] &&
            f.axes.find((a) => a.tag === "wght")?.max === face.weight[1],
        );
        if (
          !requested ||
          requested.axes.some((axis) => {
            if (axis.tag === "ital") return false;
            const actual = inspected.axes.find((a) => a.tag === axis.tag);
            return actual
              ? axis.min < actual.min || axis.max > actual.max
              : axis.tag !== "wght" ||
                  axis.min !== inspected.weight ||
                  axis.max !== inspected.weight;
          })
        )
          throw Error("Captured font binary axes mismatch");
        const sha256 = hash(bytes);
        files.set("fonts/" + sha256 + ".woff2", bytes);
        faces.push({ ...face, sha256, bytes: bytes.byteLength });
      }
      const stylesheetSha256 = hash(cssBytes);
      files.set("stylesheets/" + stylesheetSha256 + ".css", cssBytes);
      stylesheets.push({
        requestUrl,
        requestSha256: hash(requestUrl),
        stylesheetSha256,
        stylesheetBytes: cssBytes.byteLength,
        ...(capturedFontOmissions(descriptors, requestUrl).length
          ? { omittedRequests: capturedFontOmissions(descriptors, requestUrl) }
          : {}),
        faces,
      });
    }
    check();
    return {
      manifest: {
        version: 1,
        capturedAt: new Date(started).toISOString(),
        stylesheets,
      },
      files,
    };
  } finally {
    controller.abort();
    cancel();
  }
}
