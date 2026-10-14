/**
 * A canvas's pixels as a PNG Blob, encoded NOW rather than whenever the main thread next idles.
 *
 * Chromium encodes `canvas.toBlob` PNGs (and a main-thread `OffscreenCanvas.convertToBlob`) in main-thread IDLE
 * periods. While the page keeps rendering there are none: the encode waits a 1s start timeout, and one that began
 * in an idle period and then lost it finishes only at a 5s completion timeout. In the offline-file gate's container
 * the screenshot comment's Save spent 1001-1002ms of its 1.4s in `toBlob` in 3 of 8 Chromium saves (3-9ms in the
 * others; Firefox and WebKit 2-5ms). Under 8x CPU throttling and a frame-filling animation a 517px canvas took
 * 1.1-6.8s through `toBlob` and 43-101ms through `toDataURL`, the same bytes. On CI's four-vCPU runner that wait
 * outlasted the gate's 5s with Save disabled and no request sent. `toDataURL` runs the same encoder synchronously.
 */
export function encodePng(canvas: HTMLCanvasElement): Blob {
  const prefix = 'data:image/png;base64,';
  const url = canvas.toDataURL('image/png');
  // An empty (zero-sized) canvas answers `data:,`: there are no pixels to send.
  if (!url.startsWith(prefix) || url.length === prefix.length) throw new Error('The canvas has no pixels to encode.');
  const binary = atob(url.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: 'image/png' });
}
