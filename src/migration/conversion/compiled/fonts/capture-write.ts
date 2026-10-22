import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CapturedFontJob } from "./capture.ts";
/** Fresh private directories only. Publish the immutable manifest last. */
export async function writeCapturedFontJob(
  job: CapturedFontJob,
  directory: string,
): Promise<{ manifestSha256: string }> {
  const root = path.resolve(directory);
  await mkdir(root, { mode: 0o700 });
  try {
    await mkdir(path.join(root, "stylesheets"), { mode: 0o700 });
    await mkdir(path.join(root, "fonts"), { mode: 0o700 });
    for (const [name, bytes] of job.files) {
      if (
        !/^(?:fonts\/[a-f0-9]{64}\.woff2|stylesheets\/[a-f0-9]{64}\.css)$/.test(
          name,
        )
      )
        throw Error("Font capture output path refused");
      const handle = await open(path.join(root, name), "wx", 0o600);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
    }
    const manifest = JSON.stringify(job.manifest),
      handle = await open(path.join(root, "manifest.json"), "wx", 0o600);
    try {
      await handle.writeFile(manifest);
    } finally {
      await handle.close();
    }
    return {
      manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
