export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
/** The 401 breadcrumb that starts the OAuth client dance for /mcp. */
export const wwwAuthenticate = (base: string): string => `Bearer resource_metadata="${base}${PROTECTED_RESOURCE_PATH}"`;
