/**
 * WHAT WE TELL THE LLM — the one canonical "agent contract" (tok-p3, plan §4b), rendered verbatim into the
 * skill reference publishing-auth.md (llms.txt's auth section, with `[[ base ]]` as the base), the MCP
 * initialize instructions, and the start-link brief. Markdown; deterministic for a base; no token ever in a URL.
 *
 *   - Where your token lives: ~/.artifactbin.env as ARTIFACTBIN_TOKEN=mx_… (+ ARTIFACTBIN_URL=). CHECK IT FIRST;
 *     if a token is there, use it; store every newly received token there (most recent wins). The older
 *     ~/.config/artifact-bin/config.json { url, token } is still read as a fallback (legacy).
 *   - How to get one: the human pastes a start link (POST it once → { token, expiresAt }), or send the human to
 *     <base>/tokens/new and ask for the paste-back. Tokens expire — 6 h by default; expiresInHours 1–720 at mint;
 *     the mint answer's expiresAt says when.
 *   - On 401 / expired, or with no token: do not retry blindly — send the human to <base>/tokens/new, save the new
 *     token, resume. Anonymous tokens can be claimed by an account on the web, or rejected there.
 *   - Never put the token in URLs or commit it; header auth only: `Authorization: Bearer mx_…`.
 */
export function agentContract(base: string): string {
  const origin = base.replace(/\/$/, '');
  return `**Agent token contract**

Check it first: \`~/.artifactbin.env\` stores the current connection as:

\`\`\`dotenv
ARTIFACTBIN_URL=${origin}
ARTIFACTBIN_TOKEN=<token>
\`\`\`

If a token is there, use it. Store every newly received token there; the most recent token wins. As a legacy fallback, also read \`~/.config/artifact-bin/config.json\` with \`{ "url", "token" }\`.

If your user's paste says \`using this token: mx_…\`, that IS your token: save it to \`~/.artifactbin.env\` and use it.

There are two ways to get a token: the human can paste a start link, which you POST once for \`{ "token", "expiresAt" }\`, or you can send the human to ${origin}/tokens/new and ask them to paste the new token back. Tokens expire after 6 h by default; \`expiresInHours\` may be 1–720 at mint, and \`expiresAt\` says exactly when.

With no token, or after a \`401\` or expired token, do not retry blindly. Send the human to ${origin}/tokens/new, save the replacement token, and resume the interrupted work. Anonymous tokens can be claimed by an account on ${origin}/ or rejected there.

Never put a token in a URL or commit it. Send it only in the \`Authorization: Bearer <token>\` header.`;
}
