/** Shared CLI-first authentication guidance for document handoffs. */
export function agentContract(base:string):string{
 const origin=base.replace(/\/$/,'');
 return `**Agent connection: afbin CLI**

npx --yes @afbin/cli@latest authenticates itself the first time a command needs \`${origin}\`: it opens browser approval (log in, or continue anonymously), waits, and resumes the command — nothing to set up. Run \`npx --yes @afbin/cli@latest auth --server ${origin}\` to sign in deliberately; it is idempotent. Credentials live in \`~/.artifactbin/hosts/<origin-id>/credentials.env\` (0600 on Unix; private user ACLs on Windows) inside \`~/.artifactbin\` (0700). The CLI keeps credentials scoped to their server origin.

For unattended execution, add \`--yes --json\`. Browser approval is still required. If approval is pending, show the returned URL and expiry to the user, then it resumes once approved. On a refused or expired credential, run \`npx --yes @afbin/cli@latest auth\` to reconnect and resume.

Prepare Node/npm first if needed: source the helper at ${origin}/chat/ensure-node.sh (macOS/Linux), or run Invoke-RestMethod ${origin}/chat/ensure-node.ps1 | Invoke-Expression in PowerShell. Launch with npx --yes @afbin/cli@latest; Windows uses npx.cmd. The helper reuses supported Node or installs official LTS for your user. npm runs code with your user permissions; it is not a sandbox.

Local preview needs neither sign-in nor cloud access. CLI browser approval may continue as a guest. Direct HTTP clients must authenticate by email; guest browser approval is only available to the CLI. Never print a credential, put one in a URL, or commit one; the CLI keeps its own, scoped to ${origin}.

Read \`npx --yes @afbin/cli@latest help\` and the installed local skill. Help, validation and saved-state comparisons work offline.`;
}
