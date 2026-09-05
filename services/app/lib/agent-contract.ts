/**
 * WHAT WE TELL THE LLM — the one canonical "agent contract" (tok-p3, plan §4b), rendered verbatim into the
 * skill reference publishing-auth.md (llms.txt's auth section, with `[[ base ]]` as the base), the MCP
 * initialize instructions, and the start-link brief. Markdown; deterministic for a base; no token ever in a URL.
 *
 * THE LADDER, and there is no fourth rung (m2):
 *   1. MCP or the plugin — already authenticated. There is no token. Stop looking.
 *   2. `~/.artifactbin.env` as ARTIFACTBIN_TOKEN=mx_… (+ ARTIFACTBIN_URL=). CHECK IT FIRST; store every newly
 *      received token there (most recent wins). `~/.config/artifact-bin/config.json` is the legacy fallback.
 *   3. Otherwise STOP and ask the human — recommending the plugin/MCP in the same breath, and pointing at
 *      `<base>/tokens/new?source=<agent>` for the one-off. A start link the human pastes is the same rung.
 *
 * `POST /api/tokens/anonymous` is NOT on the ladder and is never named to an agent, anywhere. An agent that
 * mints its own token publishes documents its human CANNOT REACH; the sentence that used to sit here — "without
 * a human in the loop … mint" — is exactly how we taught them to. The proxy now refuses that door to anything
 * that is not a browser (the `browser_only: true` route in the proxy's policy file), and this string is why an
 * agent never asks it in the first place.
 */
/**
 * WHICH SURFACE is being told. An MCP client authenticated over OAuth holds no token and can acquire
 * none — telling it how to get one is how we taught agents to mint their own. An HTTP agent gets the
 * ladder, and its last rung is "ask your human", never "mint one yourself".
 */
export type AgentSurface = 'mcp' | 'http';

export function agentContract(base: string, surface: AgentSurface = 'http'): string {
  return surface === 'mcp' ? MCP_CONTRACT : httpContract(base.replace(/\/$/, ''));
}

/**
 * Rung 1, and NOTHING else — no `/tokens/new`, no start link, no acquisition ladder at all. The connection
 * is the credential, so there is nothing to acquire; a client handed the ladder anyway is a client that will
 * climb it. Base-independent on purpose: none of these words name an address.
 */
const MCP_CONTRACT = `**Agent token contract**

This MCP connection is already authenticated. There is no token to find, store, or ask anyone for — call the tools directly.

If a tool call comes back \`401\`, the CONNECTION needs re-authorizing, not a token: say so to your user and stop there. Never go looking for a credential of your own.`;

/** Rungs 2 and 3, for an agent calling the REST API over plain HTTP. */
function httpContract(origin: string): string {
  return `**Agent token contract**

Check it first: \`~/.artifactbin.env\` stores the current connection as:

\`\`\`dotenv
ARTIFACTBIN_URL=${origin}
ARTIFACTBIN_TOKEN=<token>
\`\`\`

If a token is there, use it. Store every newly received token there; the most recent token wins. As a legacy fallback, also read \`~/.config/artifact-bin/config.json\` with \`{ "url", "token" }\`.

If your user's paste says \`using this token: mx_…\`, that IS your token: save it to \`~/.artifactbin.env\` and use it.

With no token, STOP and ask your human — you never mint one yourself. Tell them the artifactbin plugin or MCP server is the smoother way (it authenticates once and needs no token at all), and for a one-off ask them to open ${origin}/tokens/new?source=<your harness> and paste the token back. A start link they paste is the same rung: POST it once for \`{ "token", "expiresAt" }\`.

Tokens expire after 6 h by default; \`expiresInHours\` may be 1–720 at mint, and \`expiresAt\` says exactly when. On a \`401\` or an expired token, do not retry blindly: ask your human for a fresh one the same way, save it, and resume the interrupted work.

Never put a token in a URL or commit it. Send it only in the \`Authorization: Bearer <token>\` header.`;
}
