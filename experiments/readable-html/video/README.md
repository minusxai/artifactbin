# HTML motion export probe

An optional sixteen-second illustrated bike-share explainer authored in HTML/CSS/SVG, rendered by explicit frame index and encoded to MP4. It is a trusted-fixture feasibility probe, not a product exporter or hostile HTML sandbox.

`contracts.ts` defines composition metadata, asset readiness and random-access frame rendering. `timeline.ts` owns pure timing; `fixture.ts` draws a small scene; `render.mjs` owns Chromium capture and FFmpeg encoding. The renderer embeds the fixture bundle into portable HTML; opening the generated file with `#play` starts a looping preview. Without the hash it presents frame zero for capture.

Run from the repository root:

```sh
node --import tsx --test experiments/readable-html/video/timeline.test.ts experiments/readable-html/video/road.test.ts
npx tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions experiments/readable-html/video/contracts.ts experiments/readable-html/video/timeline.ts experiments/readable-html/video/fixture.ts experiments/readable-html/video/timeline.test.ts
node experiments/readable-html/video/render.mjs /tmp/html-motion-output /path/to/ffmpeg /path/to/ffprobe
```

Use a full FFmpeg build with PNG decoding, H.264 and AAC encoding. Playwright's bundled FFmpeg lacks these capabilities. The probe used isolated temporary `ffmpeg-static` and `ffprobe-static` npm installations; no product dependency was added. The binaries must be supplied explicitly. Outputs are generated data and belong outside the repository.

The probe checks a repeated frame after arbitrary seeks and reload, then captures all 384 frames and validates encoded dimensions, rate, frame count and audio/video durations with ffprobe. Chromium is launched with `--disable-partial-raster` because default partial repaint produced small antialiased-edge differences after seeking. This validates one pinned browser/runtime configuration, not universal pixel reproducibility.

See `docs/plans/html-video-validation.md` for measured evidence and limits.

The road adapter fits both tire contact points to the SVG centerline. Pure geometry tests and browser checks cover each frame, including reverse van travel and cyclist endpoint continuity. The road model requires an open, non-looping path with monotonic chord distances.
