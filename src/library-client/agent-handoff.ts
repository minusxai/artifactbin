import { DEFAULT_AF_ORIGIN } from "../af-contracts.ts";
import type { AgentHandoff } from "./agent-handoff-contracts.ts";

export const agentHandoff: AgentHandoff = (origin, email) => {
  const server = origin.replace(/\/+$/, "");
  const address = email || "<my email address>";
  // The installer configures helpers for another server without exposing account credentials.
  const elsewhere = server === DEFAULT_AF_ORIGIN ? "" : ` --origin ${server}`;
  return `Build me an HTML artifact and publish it to ${server}.

If the artifactbin-author skill isn't installed, run: npx ${server}/skills/artefactbin-skill.tgz${elsewhere}
Then follow the skill (artifactbin-author/SKILL.md in your skills folder). To sign in, run node scripts/auth.mjs --email ${address} and ask me for the code from the email.

If I haven't said what to build, ask me.
`;
};
