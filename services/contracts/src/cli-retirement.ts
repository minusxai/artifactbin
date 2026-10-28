/**
 * THE RETIRED CLI'S ANSWER (CLI__RETIREMENT=on).
 *
 * Every afbin release up to 0.5.x sends `X-Artifactbin-Protocol: <integer>` (2, then 3) with every API request
 * (services/cli/src/http.ts on the v2-final branch), so a numeric value names an old CLI and nothing else: browsers
 * send no such header, the author skill's own client sends `native-author-v1`
 * (services/app/skills/artifactbin/scripts/toolbox-client.mjs), and the hosted check browser sends neither. The
 * credential-free reads an old CLI makes before its API calls — `/api/server` (alias discovery, User-Agent only) and
 * `/chat/release.json` (`afbin update`) — carry no protocol header, so they keep working and `afbin update` still
 * installs the retirement release.
 *
 * The refusal is shaped the way those CLIs print a server refusal: a top-level `error` string becomes the code,
 * `message` the line after it, and `hint` the fix printed under it (`cli_retired: The artifactbin CLI is retired.` /
 * `Run afbin update …`). Its status is 410: a 401 would send them to refresh and sign in again, a 409 or a 5xx changes
 * their exit code or retries. It carries no `X-Artifactbin-Protocol` header, which 0.3.x compares on every response
 * and would report as a generic protocol mismatch instead of this message.
 */
export const isRetiredCliRequest = (headers: Headers): boolean => /^[1-9][0-9]*$/.test(headers.get('x-artifactbin-protocol')?.trim() ?? '');

/** The author skill an old CLI's user moves to, on this deployment's canonical origin. */
export const retiredCliSkillUrl = (origin: string): string => `${origin}/skills/artifactbin.zip`;

export const RETIRED_CLI_MESSAGE = 'The artifactbin CLI is retired.';

const retiredCliHint = (origin: string): string =>
  `Run \`afbin update\` (or \`npx @afbin/cli@latest\`), then use the author skill: ${retiredCliSkillUrl(origin)}`;

interface RetiredCliRefusal { error: 'cli_retired'; message: string; hint: string; skill_url: string }

const retiredCliRefusal = (origin: string): RetiredCliRefusal =>
  ({ error: 'cli_retired', message: RETIRED_CLI_MESSAGE, hint: retiredCliHint(origin), skill_url: retiredCliSkillUrl(origin) });

export const retiredCliResponse = (origin: string): Response =>
  new Response(JSON.stringify(retiredCliRefusal(origin)), { status: 410, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
