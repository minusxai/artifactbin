export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
/** The `Bearer` challenge that points a client at the protected-resource metadata. */
export const wwwAuthenticate = (base: string): string => `Bearer resource_metadata="${base}${PROTECTED_RESOURCE_PATH}"`;
