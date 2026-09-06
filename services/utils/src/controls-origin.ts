/** Deployment-owned, never inferred from an author prop, query parameter, or message. */
export function parseControlsOrigin(main: string, configured: string): string {
  const root = new URL(main), child = new URL(configured);
  const local = ['localhost','127.0.0.1','[::1]'].includes(root.hostname);
  if (child.username || child.password || child.pathname !== '/' || child.search || child.hash
    || child.origin === root.origin || child.protocol !== root.protocol
    || (!local && child.protocol !== 'https:')
    || !(child.hostname === root.hostname || child.hostname.endsWith(`.${root.hostname}`))) {
    throw new Error('APP__CONTROLS_ORIGIN must be a distinct same-site HTTPS origin without a path or credentials');
  }
  return child.origin;
}
export function controlsCorsHeaders(configured: string | null, incoming: string | null): Record<string,string> | null {
  return configured && incoming === configured ? {
    'Access-Control-Allow-Origin': configured,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Artifactbin-Agent',
    'Vary': 'Origin',
  } : null;
}
