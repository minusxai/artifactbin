// A single executable is one CommonJS script: `import.meta.url` there is the executable's own file URL.
// Injected by esbuild (scripts/binary.mjs), which recognises only ES exports as injectable names.
import { pathToFileURL } from 'node:url';
export const __afbinImportMetaUrl = pathToFileURL(__filename).href;
