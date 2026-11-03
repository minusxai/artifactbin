/** D17: the platform core's flat public address. No version or hash; served with a strong ETag and `no-cache`. */
export const RUNTIME_CORE_PATH='/af/core.js';
/** A script src that loads the platform core: exactly its address. */
export const isRuntimeCoreSrc=(src:string|null|undefined):boolean=>src===RUNTIME_CORE_PATH;
