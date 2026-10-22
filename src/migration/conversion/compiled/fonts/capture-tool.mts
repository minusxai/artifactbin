/** Explicit offline tool: stdin JSON provider requests, fresh private output directory. */
import { captureFontJob } from "./capture.ts";
import { fetchFontResource } from "./capture-transport.ts";
import { createCapturedFontInspector } from "./capture-inspector.ts";
import { writeCapturedFontJob } from "./capture-write.ts";
try {
  const legacyRoot = process.argv[2],
    directory = process.argv[3];
  if (!legacyRoot || !directory || process.argv.length !== 4)
    throw Error("Font capture arguments required");
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 65_536)
      throw Error("Font capture request byte limit");
  }
  const urls = JSON.parse(text);
  if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string"))
    throw Error("Font capture requests refused");
  const job = await captureFontJob(urls, {
    fetch: fetchFontResource,
    inspect: createCapturedFontInspector(legacyRoot),
    now: Date.now,
    schedule: (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
  });
  const receipt = await writeCapturedFontJob(job, directory);
  process.stdout.write(
    JSON.stringify({
      ...receipt,
      stylesheets: job.manifest.stylesheets.length,
      faces: job.manifest.stylesheets.reduce((n, s) => n + s.faces.length, 0),
    }),
  );
} catch {
  process.stderr.write("Offline font capture failed\n");
  process.exitCode = 1;
}
