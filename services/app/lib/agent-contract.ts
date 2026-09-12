/** Shared CLI-first authentication guidance for document handoffs. */
export function agentContract(base:string):string{
 const origin=base.replace(/\/$/,'');
 return `**Agent connection**

afbin authenticates itself the first time a command needs \`${origin}\`: it opens browser approval (log in, or continue anonymously), waits, and resumes the command — nothing to set up. Run \`afbin auth --server ${origin}\` to sign in deliberately; it is idempotent. Credentials live in \`~/.artifactbin/.env\` (0600) inside \`~/.artifactbin\` (0700). The CLI keeps credentials scoped to their server origin.

For unattended execution, add \`--yes --json\`. Browser approval is still required. If approval is pending, show the returned URL and expiry to the user, then it resumes once approved. On a refused or expired credential, run \`afbin auth\` to reconnect and resume.

Not installed? \`curl -fsSL ${origin}/chat/install.sh | sh\`. Never print a credential, put one in a URL, or commit one; the CLI keeps its own, scoped to \`${origin}\`, and sends it nowhere else.

Read \`afbin help\` and the installed local skill. Help, validation and saved-state comparisons work offline.`;
}
