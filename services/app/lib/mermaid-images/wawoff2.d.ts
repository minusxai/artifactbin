declare module 'wawoff2' {
  /** Google's woff2 (WebAssembly): sfnt → woff2 and back. */
  const wawoff2: { compress(sfnt: Uint8Array): Promise<Uint8Array>; decompress(woff2: Uint8Array): Promise<Uint8Array> };
  export default wawoff2;
}
