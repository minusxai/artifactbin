export type {
  RasterImageType,
  ImageArtifact,
  ProcessedImage,
  ImageProcessor,
} from "../../datasets/attachments/image-processor-contracts.ts";
import type { RasterImageType } from "../../datasets/attachments/image-processor-contracts.ts";
/** Fixed raw-byte job, no path, URL, credentials, native options or executable input. Controller only. */
export interface ImageJobExecutor {
  execute(
    input: AsyncIterable<Uint8Array>,
    write: (chunk: Uint8Array) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): Promise<void>;
}
export interface ImageManifest {
  readonly version: "image-process-v1";
  readonly sourceType: RasterImageType;
  readonly primary: {
    readonly source: "input" | "encoded";
    readonly byteLength: number;
    readonly contentType: RasterImageType;
    readonly width: number | null;
    readonly height: number | null;
  };
  readonly small: null | {
    readonly byteLength: number;
    readonly width: number;
    readonly height: number;
  };
  readonly placeholder: string | null;
}
export const IMAGE_PROCESS_LIMITS = Object.freeze({
  inputBytes: 50_000_000,
  outputBytes: 100_010_000,
  headerBytes: 8192,
  pixels: 16_000_000,
  dimension: 32768,
  jobMs: 15_000,
  transportMs: 20_000,
});
export interface RasterMetadata {
  readonly width: number;
  readonly height: number;
  readonly pages: number;
}
export interface RasterEncoded {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}
/** Implemented only inside the sandbox. Tests inject finite synthetic candidates, never a native app decoder. */
export interface RasterDecoder {
  metadata(input: Uint8Array): Promise<RasterMetadata>;
  encode(
    input: Uint8Array,
    operation: "primary-png" | "primary-lossy" | "placeholder" | "small",
  ): Promise<RasterEncoded>;
}
export interface RasterResult {
  readonly manifest: ImageManifest;
  readonly primary: Uint8Array | null;
  readonly small: Uint8Array | null;
}
/** Controller-owned cleanup command; never exposed to an uploaded file or app runtime. */
export interface ImageContainerCommands {
  (arguments_: readonly string[], timeoutMs: number): Promise<string>;
}
/** App-owned private output directory lifecycle, injectable for cancellation/cleanup behavior. */
export interface ImageTemporaryDirectories {
  create(): Promise<string>;
  remove(path: string): Promise<void>;
}
