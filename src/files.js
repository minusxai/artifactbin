import {
  openSync,
  closeSync,
  fsyncSync,
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { hash } from "./document.js";
export function updateFile(path, transform, expected) {
  let lock;
  try {
    lock = openSync(path + ".lock", "wx", 0o600);
  } catch {
    throw Error(
      "File is being updated. Retry shortly; remove an abandoned .lock only after stopping its writer.",
    );
  }
  try {
    const previous = readFileSync(path, "utf8");
    if (expected && hash(previous) !== expected)
      throw Object.assign(
        Error("File changed on disk. Save a recovery copy before reloading."),
        { status: 412 },
      );
    const next = transform(previous),
      temp = path + ".tmp";
    const fd = openSync(temp, "w", 0o600);
    try {
      writeFileSync(fd, next);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    const dir = openSync(dirname(path), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    return { html: next, etag: hash(next) };
  } finally {
    closeSync(lock);
    unlinkSync(path + ".lock");
  }
}
