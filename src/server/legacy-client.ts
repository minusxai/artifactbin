/**
 * Answers for the earlier product's clients: the `afbin` CLI (its API lived
 * under /api/artifacts and signed in at /oauth/device) and its skill, which
 * sent HTTP-only agents to /llms.txt and the /chat install scripts. Every such
 * request is 410 with the same text: what changed and how to install the
 * author skill. The CLI prints a JSON error's `error`, `message` and `hint`
 * fields verbatim, so a machine with saved credentials reads the instruction
 * on its next command; the text forms serve agents following the old skill.
 * Pure: the origin is a parameter.
 */
import { INSTALLER_ARCHIVE_PATH } from "./installer-archive-contracts.ts";

export interface LegacyClientAnswer {
  status: 410;
  headers: Record<string, string>;
  body: string;
}

const JSON_PREFIXES = ["/api/artifacts", "/oauth/"];
const TEXT_PATHS = ["/llms.txt", "/chat/install.sh", "/chat/install-node.sh"];
const TEXT_PREFIXES = ["/llms/"];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");

export function legacyClientMessage(origin: string): { message: string; hint: string } {
  return {
    message: "This server now hosts HTML pages; the Artifactbin JSX API and the afbin CLI are retired.",
    hint:
      `Install the new author skill with: npx ${origin}${INSTALLER_ARCHIVE_PATH} and restart your agent. ` +
      `Existing artifacts keep their ${origin}/a/<id> addresses; a page's source is now HTML, not JSX.`,
  };
}

/** The 410 answer for a legacy client path, or null when the path is not one. */
export function legacyClientAnswer(pathname: string, origin: string): LegacyClientAnswer | null {
  const text = legacyClientMessage(origin);
  if (JSON_PREFIXES.some((prefix) => matches(pathname, prefix)))
    return {
      status: 410,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "server_migrated", ...text }),
    };
  if (TEXT_PATHS.includes(pathname) || TEXT_PREFIXES.some((prefix) => pathname.startsWith(prefix)))
    return {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: `${text.message}\n${text.hint}\n`,
    };
  return null;
}
