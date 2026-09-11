/** Shared CLI-first authentication guidance for document handoffs. */
export function agentContract(base:string):string{
 const origin=base.replace(/\/$/,'');
 return `**Agent connection**

Run \`afbin setup --server ${origin}\` to connect through your browser and select local skills. Credentials live in \`~/.artifactbin/.env\` (0600) inside \`~/.artifactbin\` (0700). The CLI keeps credentials scoped to their server origin.

For unattended execution, add \`--yes --json\`. This accepts setup defaults, but browser approval is still required. If approval is pending, show the returned URL and expiry to the user, then rerun setup after approval. On a refused or expired credential, run setup to reconnect and resume.

If the human explicitly supplies a token, use \`ARTIFACTBIN_URL=${origin}\` and \`ARTIFACTBIN_TOKEN\` in the process environment. Environment credentials override the saved connection. Never mint your own anonymous token, put a token in a URL, print it in logs or commit it. The CLI sends \`Authorization: Bearer\` only to the configured origin.

Read \`afbin help\` and the installed local skill. Help, validation and saved-state comparisons work offline.`;
}
