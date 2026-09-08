import {cookieName, decodeAgentSession} from '@artifactbin/utils';
import type {AgentSession, Queryable, TokenReader} from '@artifactbin/contracts';
import {createAgentBrowserSessions} from './agent-browser-session';

const oneCookie = (header: string | null, name: string): string | null => {
  const matches = (header ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith(name + '='));
  const [match] = matches;
  return matches.length === 1 && match !== undefined ? match.slice(name.length + 1) : null;
};

/** Cookie lifecycle at the proxy boundary; the app still owns token adoption.
 * The signed browser nonce must also be live in the database. Disconnect
 * revokes this browser, not everyone with its token. No read cookie is issued. */
export function createAgentBrowser(opts: {db: Queryable; tokens: TokenReader; secret: string; secure: boolean; schema?: string}) {
  const sessions = createAgentBrowserSessions(opts.db, opts.schema);
  const fullName = cookieName(opts.secure);
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
    async observeResponse(previous: string | null, response: Headers): Promise<void> {
      const changes = response.getSetCookie().filter(c => c.startsWith(fullName + '='));
      const [change] = changes;
      if (change === undefined) return;
      if (changes.length !== 1) throw new Error('Ambiguous agent session response');
      const [pair = ''] = change.split(';');
      const value = pair.slice(fullName.length + 1);
      const old = signed(previous);
      if (old?.sessionId) await sessions.revoke(old.sessionId);
      if (!value || /;\s*Max-Age=0(?:;|$)/i.test(change)) return;
      const next = decodeAgentSession(value, opts.secret), primary = next?.tokenIds.at(-1);
      if (!next?.sessionId || !primary || !await liveToken(primary)) throw new Error('Invalid new browser session');
      await sessions.register(next.sessionId, primary);
    },
  };
}
