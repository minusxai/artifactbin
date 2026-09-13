/** The supplied masks encode coverage in red, not their opaque alpha channel. */
export function applyForegroundMask(
  pixels: Uint8ClampedArray,
  mask: Uint8ClampedArray,
) {
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = mask[i];
}
