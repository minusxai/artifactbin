/** The page's asset door (`IslandPageData.managedAssets`) and the asset kinds a store may import through it. */
export interface ManagedAssetsConfig {origin: string; resolveUrl: string}
export type ManagedAssetKind='image'|'font'|'pdf'|'script'|'binary';
