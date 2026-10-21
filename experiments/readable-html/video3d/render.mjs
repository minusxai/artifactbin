// Trusted-fixture research, not an isolation boundary for arbitrary uploaded HTML.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const [outputArg, ffmpeg, ffprobe] = process.argv.slice(2);
if (!outputArg || !ffmpeg || !ffprobe) throw new Error("Usage: node render.mjs OUTPUT_DIRECTORY FFMPEG FFPROBE");
const output = resolve(outputArg);
await mkdir(join(output, "frames"), { recursive: true });
const bundle = await build({ entryPoints: ["experiments/readable-html/video3d/fixture.ts"], bundle: true, write: false, format: "iife" });
const html = `<!doctype html><meta charset="utf-8"><title>A tiny city — genuine 3D HTML composition</title><body><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>`;
const htmlPath = join(output, "composition.html");
await writeFile(htmlPath, html);
const started = performance.now();
const browser = await chromium.launch({ args: ["--disable-partial-raster"] });
let spec;
let captures = 0;
let meshWheelContactChecks = 0;
const frameHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  // Useful reproducibility guard only: no claim of hostile code containment.
  await context.route(/^https?:/, route => route.abort());
  const page = await context.newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  await page.evaluate(() => window.composition.ready);
  spec = await page.evaluate(() => window.composition.spec);
  async function screenshot(frame, path) {
    await page.evaluate(frame => window.composition.renderFrame(frame), frame);
    const e=await page.evaluate(()=>window.sceneEvidence);
    meshWheelContactChecks+=e.wheelBottoms.length;
    assert.ok(e.wheelBottoms.every(y=>Math.abs(y-e.roadY)<1e-6), 'actual wheel mesh contact');
    const t=.38+frame/287*Math.PI*1.65, tx=-8*Math.sin(t), tz=5*Math.cos(t), n=Math.hypot(tx,tz);
    assert.ok(Math.abs(e.heading[0]-tx/n)<1e-9 && Math.abs(e.heading[2]-tz/n)<1e-9,'actual world heading tangent');
    assert.ok(Math.abs(e.vehicle.x-8*Math.cos(t))<1e-9 && Math.abs(e.vehicle.z-5*Math.sin(t))<1e-9,'actual bus on path');
    for(const corner of e.corners){let nearest=Infinity;for(let j=0;j<4096;j++){const a=j/4096*Math.PI*2;nearest=Math.min(nearest,Math.hypot(corner.x-8*Math.cos(a),corner.z-5*Math.sin(a)));}assert.ok(nearest<1.04,'full bus footprint inside road ribbon');}
    captures++;
    return page.screenshot({ type: "png", ...(path ? { path } : {}) });
  }
  await screenshot(120, join(output, "poster.png"));
  const expected = frameHash(await screenshot(32, join(output, "seek-before.png")));
  await screenshot(spec.frameCount - 1);
  await screenshot(0);
  assert.equal(frameHash(await screenshot(32, join(output, "seek-after.png"))), expected, "same frame after arbitrary seeks");
  await page.reload();
  await page.evaluate(() => window.composition.ready);
  assert.equal(frameHash(await screenshot(32)), expected, "same frame after reload");
  for (let frame = 0; frame < spec.frameCount; frame++) {
    await screenshot(frame, join(output, "frames", `${String(frame).padStart(5, "0")}.png`));
  }
} finally {
  await browser.close();
}
const captureSeconds = (performance.now() - started) / 1000;
// An explicit PCM soundtrack, independent of browser playback and wall clock.
const sampleRate = 48000;
const sampleCount = spec.frameCount / spec.fps * sampleRate;
const wav = Buffer.alloc(44 + sampleCount * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(sampleCount * 2, 40);
for (let i = 0; i < sampleCount; i++) {
  const t = i / sampleRate;
  const phase = t % 4;
  const envelope = phase < 0.22 ? Math.sin(Math.PI * phase / 0.22) : 0;
  const frequency = [261.626, 329.628, 391.995, 523.251][Math.floor(t / 4) % 4];
  wav.writeInt16LE(Math.round((Math.sin(2 * Math.PI * frequency * t) * envelope * 3500 + (Math.sin(2 * Math.PI * frequency / 2 * t) + Math.sin(2 * Math.PI * frequency * 1.5 * t)) * 420 * Math.sin(Math.PI * phase / 4))), 44 + i * 2);
}
await writeFile(join(output, "soundtrack.wav"), wav);
const video = join(output, "html-to-video.mp4");
execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(spec.fps), "-i", join(output, "frames", "%05d.png"), "-i", join(output, "soundtrack.wav"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", "-t", String(spec.frameCount / spec.fps), video]);
const media = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", video], { encoding: "utf8" }));
const v = media.streams.find(s => s.codec_type === "video");
const a = media.streams.find(s => s.codec_type === "audio");
assert.equal(v.width, spec.width);
assert.equal(v.height, spec.height);
assert.equal(Number(v.nb_read_frames), spec.frameCount);
assert.equal(v.avg_frame_rate, `${spec.fps}/1`);
assert.equal(Number(v.duration), spec.frameCount / spec.fps);
assert.equal(a.codec_name, "aac");
assert.ok(Math.abs(Number(a.duration) - spec.frameCount / spec.fps) <= 0.03);
execFileSync(ffmpeg,["-v","error","-i",video,"-f","null","-"]);
const result = { actualMeshContactAndFootprintAndTangent:true, fullyDecoded:true, spec, captures, meshWheelContactChecks, sameFrameAfterSeekAndReload: true, captureSeconds, videoCodec: v.codec_name, audioCodec: a.codec_name, frameCount: Number(v.nb_read_frames), duration: Number(v.duration), audioDuration: Number(a.duration), bytes: (await stat(video)).size, totalSeconds: (performance.now() - started) / 1000 };
await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
