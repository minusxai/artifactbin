import type {
  DocumentDownload,
  DocumentDownloadOptions,
  DocumentDownloadSink,
} from "./document-download-contracts.ts";
import { withState } from "./core/standalone.ts";

const started =
  "Download started — keep the downloaded file to preserve changes.";

/** Exports the selected document while keeping historical and viewer state separate. */
export function createDocumentDownload(
  options: DocumentDownloadOptions,
): DocumentDownload {
  return {
    download() {
      if (options.local) {
        options.delegate();
        options.status(started);
        return "download-started";
      }
      const address = new URL(options.address());
      const versions = address.searchParams.getAll("version");
      address.search = "?download=1";
      for (const version of versions) address.searchParams.append("version", version);
      address.hash = "";
      const name =
        (options
          .hostedPath()
          ?.split("/")
          .at(-1)
          ?.replace(/\.html$/i, "") ||
          options
            .title()
            .replace(/[^a-z0-9 _-]/gi, "")
            .trim()
            .slice(0, 80) ||
          "pagegi") + ".html";
      const snapshot = options.snapshot();
      const state = snapshot.historical ? null : snapshot.state;
      void (async () => {
        const response = await options.fetch(address.href, {
          credentials: "same-origin",
        });
        if (!response.ok) throw Error("Download failed");
        const html = await response.text();
        const file = new Blob([state ? withState(html, state) : html], {
          type: "text/html",
        });
        const url = options.sink.create(file);
        try {
          options.sink.start(url, name);
          options.sink.later(() => options.sink.release(url), 60_000);
        } catch (error) {
          options.sink.release(url);
          throw error;
        }
      })().catch((error) =>
        options.status(
          error instanceof Error ? error.message : "Download failed",
        ),
      );
      options.status(started);
      return "download-started";
    },
  };
}

/** Browser effects are kept at this boundary so export behavior needs no DOM. */
export function createBrowserDownloadSink(
  document: Pick<Document, "createElement">,
  urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">,
  later: (callback: () => void, delay: number) => unknown,
): DocumentDownloadSink {
  return {
    create: (file) => urls.createObjectURL(file),
    start(url, name) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
    },
    release: (url) => urls.revokeObjectURL(url),
    later: (callback, delay) => {
      later(callback, delay);
    },
  };
}
