/** D17: the platform core's flat public address. No version or hash; served with a strong ETag and `no-cache`. */
export const RUNTIME_CORE_PATH='/af/core.js';
/** The one platform core loader recognized by authoring and portable copies. */
export const isRuntimeCoreSrc=(src:string|null|undefined):boolean=>src===RUNTIME_CORE_PATH;
