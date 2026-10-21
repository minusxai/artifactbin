/**
 * The text a person pastes into their coding agent to have it build and
 * publish an HTML artifact on this server. It is public and tokenless: it names
 * the server, its npx skill installer, the installed artifactbin-author skill,
 * and how to sign in. Other servers get an explicit installer --origin.
 * `email` is the signed-in account's address; without it the text
 * leaves a placeholder for the person to fill in.
 */
export interface AgentHandoff {
  (origin: string, email?: string): string;
}
