export type RasterImageType = "image/png" | "image/jpeg" | "image/webp";
export interface ImageArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly contentType: RasterImageType;
}
export interface ProcessedImage {
  readonly primary: ImageArtifact;
  readonly small?: ImageArtifact & {
    readonly contentType: "image/webp";
    readonly width: number;
    readonly height: number;
  };
  readonly width: number | null;
  readonly height: number | null;
  readonly placeholder: string | null;
  readonly totalBytes: number;
  /** Deletes generated temporary outputs only; the caller always owns the source path. */
  dispose(): Promise<void>;
}
export interface ImageProcessor {
  process(
    source: {
      readonly path: string;
      readonly byteLength: number;
      readonly contentType: RasterImageType;
    },
    signal?: AbortSignal,
  ): Promise<ProcessedImage>;
  close(): Promise<void>;
}
