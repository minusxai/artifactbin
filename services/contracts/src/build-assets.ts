/** App-owned public build bytes, reachable by the proxy's upstream seam only. */
export const BUILD_ASSET_PATH = '/api/internal/build-assets';
/** Set by the build-file handler only after manifest admission and a file hit. */
export const BUILD_ASSET_HEADER = 'x-artifactbin-build-asset';
