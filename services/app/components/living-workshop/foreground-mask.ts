/** Masks encode coverage in grayscale: white is foreground, black is background. */
export function applyForegroundMask(
  pixels: Uint8ClampedArray,
  mask: Uint8ClampedArray,
) {
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = mask[i];
}
