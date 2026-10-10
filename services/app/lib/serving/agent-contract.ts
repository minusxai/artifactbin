/** Shared CLI-first authentication guidance for document handoffs. */
export function agentContract(base:string):string{
 const origin=base.replace(/\/$/,'');
 return `**Agent connection: afbin CLI**

afbin authenticates itself the first time a command needs \`${origin}\`: it opens the browser, where a browser already signed in on this machine connects with no click (otherwise log in with email), and resumes the command — nothing to set up. Run \`afbin auth --server ${origin}\` to sign in deliberately; it is idempotent. Credentials live in \`~/.artifactbin/hosts/<origin-id>/credentials.env\` (0600 on Unix; private user ACLs on Windows) inside \`~/.artifactbin\` (0700). The CLI keeps credentials scoped to their server origin.

For unattended execution, add \`--yes --json\`. A signed-in browser on the same machine still connects with no click; remote or headless machines fall back to approving a code. If approval is pending, show the returned URL and expiry to the user, then it resumes once approved. On a refused or expired credential, run \`afbin auth\` to reconnect and resume.

If \`afbin\` is not installed, run \`npx --yes @afbin/cli@latest setup\` once (Windows PowerShell: \`npx.cmd --yes @afbin/cli@latest setup\`); it installs the \`afbin\` command and the agent skills. Prepare Node/npm first if needed: source the helper at ${origin}/chat/ensure-node.sh (macOS/Linux), or run Invoke-RestMethod ${origin}/chat/ensure-node.ps1 | Invoke-Expression in PowerShell. The helper reuses supported Node or installs official LTS for your user. npm runs code with your user permissions; it is not a sandbox.

Local preview needs neither sign-in nor cloud access. CLI browser approval and direct HTTP authentication require an email account. Never print a credential, put one in a URL, or commit one; the CLI keeps its own, scoped to ${origin}.

Read \`afbin help\` and the installed local skill. Help, validation and saved-state comparisons work offline.`;
}
