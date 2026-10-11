/**
 * Home's first request is `/api/page/home?part=bootstrap`. The personal-shelf tests still describe their
 * world as the shelf (`part=core`); this answers the bootstrap from that description: Personal with the
 * given shelf, or signed out when the shelf says so. Failures and pending responses pass through unchanged.
 */
const PUBLIC_DEPLOYMENT = { mode: 'public', setup_complete: true, is_owner: false, default_group: null };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function personalBootstrap(handler: Handler, init?: RequestInit): Promise<Response> {
  return Promise.resolve(handler('/api/page/home?part=core', init)).then(async (res) => {
    if (!res.ok) return res;
    const core = await res.json();
    return Response.json(core.signedIn === false
      ? { signedIn: false, deployment: PUBLIC_DEPLOYMENT }
      : { signedIn: true, accountId: core.accountId, deployment: PUBLIC_DEPLOYMENT, preferences: { default_destination: { type: 'personal' } }, destination: { kind: 'personal', core: { artifacts: core.artifacts, shared: core.shared } } });
  });
}

/** `handler` for every URL except the bootstrap, which is derived from its shelf answer. */
export const withPersonalBootstrap = (handler: Handler) => (url: string, init?: RequestInit): Response | Promise<Response> =>
  url.includes('part=bootstrap') ? personalBootstrap(handler, init) : handler(url, init);
