/** D17: the platform core's flat public address. No version or hash; served with a strong ETag and `no-cache`. */
export const RUNTIME_CORE_PATH='/af/core.js';
/** The pre-D17 address, still served as an alias and still recognized in stored sources. */
const LEGACY_CORE_PATH='/af/v1/core.js';
/** A script src that loads the platform core: the D17 address or its legacy alias (stored sources keep either). */
export const isRuntimeCoreSrc=(src:string|null|undefined):boolean=>src===RUNTIME_CORE_PATH||src===LEGACY_CORE_PATH;
