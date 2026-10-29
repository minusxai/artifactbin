/**
 * The agent-copy module's interface: what the product tells an agent — the contract a minted token carries, the
 * paste for an existing document, the discovery pointer every page carries, and the public guides and llms.txt
 * (read from the skill tree on disk, so this index is server-only). Browser code imports the leaf files agent-copy,
 * getting-started (the getting-started guide) and setup-installers (its installer options).
 */
export { agentContract } from './agent-contract';
export { existingPaste } from './agent-copy';
export { agentBlurb, agentDiscovery, agentDiscoveryBody, agentDiscoveryHead, withAgentDiscoveryTail } from './agent-discovery';
export { llmsText, publicGuideText } from './agent-references.server';
