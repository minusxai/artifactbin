import { createRequire } from "node:module";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
let root;
try { root = dirname(require.resolve("node-pty/package.json")); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  process.exit(0); // Document commands work without the optional terminal integration.
}
for (const file of [
  "build/Release/spawn-helper",
  `prebuilds/${process.platform}-${process.arch}/spawn-helper`,
]) {
  const path = join(root, file);
  if (existsSync(path)) chmodSync(path, 0o755);
}
