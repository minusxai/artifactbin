import {cookieName, decodeAgentSession} from '@artifactbin/utils';
import type {AgentSession, Queryable, TokenReader} from '@artifactbin/contracts';
import {createAgentReadSessions} from './agent-read-session';

const oneCookie = (header: string | null, name: string): string | null => {
  const matches = (header ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
};

/** Cookie lifecycle at the proxy boundary; the app still owns token adoption.
 * A returned agent cookie gets separate read authority before reaching the
 * browser. Disconnect/rotation revokes this browser, not everyone with its token. */
export function createAgentBrowser(opts: {db: Queryable; tokens: TokenReader; secret: string; main: string; secure: boolean; schema?: string}) {
  const sessions = createAgentReadSessions(opts.db, opts.schema);
  const fullName = cookieName(opts.secure), readName = opts.secure ? '__Secure-mx-agent-read' : 'mx-agent-read';
  const attributes = `; Domain=${new URL(opts.main).hostname}; Path=/; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`;
  const signed = (header: string | null) => decodeAgentSession(oneCookie(header, fullName), opts.secret);
  const liveToken = (id: string) => {
    // Browser read handles promise revocation on the next request, not the
    // general bearer reader's five-second positive-cache window.
    opts.tokens.invalidate(id);
    return opts.tokens.byId(id);
  };
  return {
    fullName,
    async full(header: string | null): Promise<AgentSession | null> {
      const held = signed(header), primary = held?.tokenIds.at(-1);
      if (!held?.sessionId || !primary || !await sessions.live(held.sessionId, primary) || !await liveToken(primary)) return null;
      return held;
    },
    async read(header: string | null) {
      const value = oneCookie(header, readName);
      const id = value ? await sessions.resolve(value) : null;
      return id ? liveToken(id) : null;
    },
    async responseCookies(previous: string | null, response: Headers): Promise<string[]> {
      const changes = response.getSetCookie().filter(c => c.startsWith(fullName + '='));
      if (!changes.length) return [];
      if (changes.length !== 1) throw new Error('Ambiguous agent session response');
      const pair = changes[0].split(';')[0], value = pair.slice(fullName.length + 1);
      const old = signed(previous);
      if (old?.sessionId) await sessions.revoke(old.sessionId);
      if (!value || /;\s*Max-Age=0(?:;|$)/i.test(changes[0])) return [`${readName}=${attributes}; Max-Age=0`];
      const next = decodeAgentSession(value, opts.secret), primary = next?.tokenIds.at(-1);
      if (!next?.sessionId || !primary || !await liveToken(primary)) throw new Error('Invalid new browser session');
      const read = await sessions.issue(next.sessionId, primary);
      return [`${readName}=${read.token}${attributes}; Expires=${read.expiresAt.toUTCString()}`];
    },
  };
}
