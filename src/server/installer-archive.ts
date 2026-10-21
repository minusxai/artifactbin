import { readFileSync } from "node:fs";
import type { PlatformAsset } from "./assets-contracts.ts";
import { INSTALLER_ARCHIVE_FILE } from "./installer-archive-contracts.ts";

/** Built with npm pack so npm/npx can install it directly without a registry. */
export function installerArchive(): PlatformAsset {
 return {
  body: readFileSync(new URL(INSTALLER_ARCHIVE_FILE, import.meta.url)),
  headers: {
   "Content-Type": "application/gzip",
   "Content-Disposition": 'attachment; filename="artefactbin-skill.tgz"',
   "Cache-Control": "public, max-age=300",
   "Access-Control-Allow-Origin": "*",
   "Cross-Origin-Resource-Policy": "cross-origin",
  },
 };
}
