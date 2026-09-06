import { createRequire } from "node:module";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("node-pty/package.json"));
for (const file of [
  "build/Release/spawn-helper",
  `prebuilds/${process.platform}-${process.arch}/spawn-helper`,
]) {
  const path = join(root, file);
  if (existsSync(path)) chmodSync(path, 0o755);
}
