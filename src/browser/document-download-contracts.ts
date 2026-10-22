import type { AfJsonObject } from "../af-contracts.ts";

export interface DocumentDownloadSink {
  create(file: Blob): string;
  start(url: string, name: string): void;
  release(url: string): void;
  later(callback: () => void, delay: number): void;
}
export interface DocumentDownloadOptions {
  local: boolean;
  delegate(): void;
  hostedPath(): string | null | undefined;
  address(): string;
  title(): string;
  snapshot(): { historical: boolean; state: AfJsonObject | null };
  fetch(
    address: string,
    options: { credentials: "same-origin" },
  ): Promise<{
    ok: boolean;
    text(): Promise<string>;
  }>;
  sink: DocumentDownloadSink;
  status(message: string): void;
}
export interface DocumentDownload {
  download(): "download-started";
}
