/**
 * THE BUNDLE IS ORIGIN-FREE UNTIL IT IS USED.
 *
 * The skill sources address the server as `[[ base ]]` so one corpus can serve
 * any deployment. The CLI bundle used to render that once, at COMPILE time,
 * against a fixed origin — so every installed skill told the agent to fetch
 * from that host no matter which server the CLI was pointed at, and a
 * self-hoster's agent was taught to talk to somebody else's box.
 *
 * So compilation renders the placeholder below instead, and the origin is
 * substituted where it is finally known: when the skill is installed, and
 * when `afbin help` prints a reference. The token is deliberately not a URL —
 * a substitution that is missed produces `__AFBIN_SERVER__/chat/install.sh`,
 * which fails loudly, rather than a plausible link to the wrong server.
 */
export const TEACHING_BASE = '__AFBIN_SERVER__';

const TOKEN = new RegExp(TEACHING_BASE, 'g');

/** One rendered document, addressed to `origin` (trailing slash trimmed, as every server origin is). */
export function withTeachingOrigin(text: string, origin: string): string {
  return text.replace(TOKEN, origin.replace(/\/+$/, ''));
}

/** A whole bundle — the installed skill tree — addressed to `origin`. */
export function teachingFilesFor(files: Readonly<Record<string, string>>, origin: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([path, text]) => [path, withTeachingOrigin(text, origin)]));
}
