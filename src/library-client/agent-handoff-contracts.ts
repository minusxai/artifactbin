/**
 * The text a person pastes into their coding agent to have it build and
 * publish a page on this server. It is public and tokenless: it names the
 * server, the one-line install of the author skill (`/install.sh`), how to
 * sign in, and names `AF_SERVER` only when this server is not the skill's
 * default. `email` is the signed-in account's address; without it the text
 * leaves a placeholder for the person to fill in.
 */
export interface AgentHandoff {
  (origin: string, email?: string): string;
}
