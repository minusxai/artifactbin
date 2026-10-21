export interface PlatformAsset {
  body: string | Uint8Array;
  headers: Record<string, string>;
}
export interface PlatformAssets {
  /**
   * `request.signedIn` says whether the request carried the website's account
   * cookie (not whether it is still valid); the home page tells its script when
   * it did not, so a visitor who never signed in asks the API for nothing.
   */
  resolve(
    method: string,
    url: URL,
    request?: { signedIn: boolean },
  ): PlatformAsset | null;
}
/** The CLI pairing and its /connect page are gone; nothing to configure. */
export interface PlatformAssetOptions {}
