import { createRequire } from "node:module";
// Binary builds replace this module with an embedded native-package loader.
const require = createRequire(import.meta.url);
export const pty: typeof import("node-pty") = require("node-pty");
