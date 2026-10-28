import { createRequire } from "node:module";
// npm supplies the platform prebuild; the CLI never downloads a separate native runtime.
const require = createRequire(import.meta.url);
export const pty: typeof import("node-pty") = require("node-pty");
