import { DEFAULT_AF_ORIGIN, INSTALL_SCRIPT_PATH } from "../af-contracts.ts";
import type { AgentHandoff } from "./agent-handoff-contracts.ts";

export const agentHandoff: AgentHandoff = (origin, email) => {
  const server = origin.replace(/\/+$/, "");
  const address = email || "<my email address>";
  // The scripts already point at the default server; only another server needs naming.
  const elsewhere = server === DEFAULT_AF_ORIGIN ? "" : ` Set AF_SERVER=${server} for its scripts.`;
  return `Build me a Pagegi page and publish it to ${server}.

If the pagegi-author skill isn't installed, run: curl -fsSL ${server}${INSTALL_SCRIPT_PATH} | sh
Then follow the skill (pagegi-author/SKILL.md in your skills folder).${elsewhere} To sign in, run node scripts/auth.mjs --email ${address} and ask me for the code from the email.

If I haven't said what to build, ask me.
`;
};
