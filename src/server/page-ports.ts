/**
 * Lazy ports to modules other briefs own. The paths are runtime values so this
 * server builds and runs before they exist: a page without backends never
 * loads the backend module, and a missing module is a 503, not a crash.
 */
import type { PageModelModule } from "../page/page-contracts.ts";
import type { BackendFilesModule } from "../backend/af-backend-contracts.ts";
import { fail } from "../errors.ts";
import { hash } from "./text.ts";

/**
 * Shared page state is keyed by the digest of the page's current source, which
 * the hosted runtime computes the same way (src/browser/document-session.js).
 * A save carries the state forward to the new digest, so state survives saves.
 */
export const PAGE_STATE_SCHEMA = 0;
const REVISION_PREFIX = "pagegi-readable-v2/parse5-7.3.0\n";
export const sourceDigest = (source: string): string =>
  hash(REVISION_PREFIX + source);

function missing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ERR_MODULE_NOT_FOUND" ||
      error.code === "ERR_UNSUPPORTED_DIR_IMPORT")
  );
}

function lazy<T>(path: string, unavailable: string) {
  let loaded: Promise<T | null> | undefined;
  return {
    /** The module, or null when it is not installed. */
    optional(): Promise<T | null> {
      return (loaded ||= (import(path) as Promise<T>).catch((error) => {
        loaded = undefined;
        if (missing(error)) return null;
        throw error;
      }));
    },
    async required(): Promise<T> {
      return (await this.optional()) ?? fail(503, unavailable);
    },
  };
}

export const pageModelModule = lazy<PageModelModule>(
  "../page/page-model.ts",
  "The page model is not available on this server",
);
export const backendFilesModule = lazy<BackendFilesModule>(
  "../backend/af-files.ts",
  "Backend files are not available on this server",
);

/** PageError (src/page/page-contracts.ts) becomes a 422 naming the line. */
export function pageProblem(error: unknown): never {
  if (error instanceof Error && error.name === "PageError") {
    const line = (error as { line?: unknown }).line;
    fail(
      422,
      typeof line === "number" && line > 0
        ? `Line ${line}: ${error.message}`
        : error.message,
    );
  }
  throw error;
}
