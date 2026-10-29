/** Tokenless, origin-bound HTTP guidance for document handoffs. */
export function agentContract(base:string):string{
 const origin=base.replace(/\/$/,'');
 return `Use the artifactbin author skill and HTTP API for ${origin}. Read ${origin}/llms.txt; download the skill from ${origin}/skills/artifactbin.zip if needed. Reuse origin-scoped credentials before signing in. Read ${origin}/llms/http-auth for email authentication, private credential storage and serialized refresh. Authenticate as the recipient; a shared link does not grant edit access. Never print credentials, place them in URLs, or commit them.`;
}
