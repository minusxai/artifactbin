# Genuine 3D HTML video research

A 12-second 960×540, 24fps miniature-city explainer: Three.js meshes, directional shadows, orthographic camera orbit, an amber bus on an elliptical road, and HTML typography. All geometry is authored here; there are no downloaded models, images, fonts or runtime network requests.

The road ribbon and bus share `poseAt`. Bus wheel meshes have world-space lower bounds at the rendered roadway height. The frame renderer verifies all four wheel contacts, the actual bus direction and all four footprint corners on every captured frame. These checks prevent the floating/off-road vehicle defect in the previous flat illustration.

```
npm ci --prefix experiments/readable-html/video3d --ignore-scripts
node --import tsx --test experiments/readable-html/video3d/model.test.ts
./node_modules/.bin/tsc -p experiments/readable-html/video3d/tsconfig.json
node experiments/readable-html/video3d/render.mjs OUTPUT_DIRECTORY FFMPEG_BINARY FFPROBE_BINARY
```

Output: self-contained `composition.html` (append `#play` for realtime looping preview), PNG frames/poster, explicit synthesized WAV soundtrack, H.264/AAC MP4 and machine-readable evidence. Browser capture blocks HTTP as a reproducibility guard, not as hostile-code containment. The built HTML includes Three.js under its MIT license.

This proves deliberately authored 3D scenes can use the same explicit-frame export contract as 2D HTML. It does not turn arbitrary HTML into 3D or establish pixel identity across GPUs, browser versions or drivers. The render is trusted-fixture research, not a production video job sandbox. Keep optional video tooling outside the core portable-HTML runtime.
