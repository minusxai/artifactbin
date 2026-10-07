import { afbinInstallCommand, afbinServerFlag, afbinWindowsInstallCommand } from './agent-discovery-tags';

export type GuideBlock =
  | { kind: 'text'; text: string }
  | { kind: 'command'; label: string; language: 'sh' | 'powershell'; text: string };

/** One source for the human page, agent Markdown, and the compact installation panel.
 * Pure and browser-safe; the caller supplies its deployment origin. */
export function gettingStarted(base: string) {
  const origin = base.replace(/\/+$/, '');
  const server = afbinServerFlag(origin);
  const sections: Array<{ id: string; title: string; blocks: GuideBlock[] }> = [
    { id: 'install', title: 'Install afbin', blocks: [
      { kind: 'text', text: 'If afbin is not installed, install and set it up first. Run one command for your platform. It reuses supported Node/npm or installs official Node LTS for your user, then installs afbin and the artifactbin skill for your coding agents. Open a new terminal after installation. Setup supports Claude Code, Codex, Pi, and OpenCode; choose which agents receive the skill.' },
      { kind: 'command', label: 'macOS / Linux', language: 'sh', text: afbinInstallCommand(origin) },
      { kind: 'command', label: 'Windows · PowerShell', language: 'powershell', text: afbinWindowsInstallCommand(origin) },
      { kind: 'text', text: `Already have Node/npm? Run npx --yes @afbin/cli@latest setup${server} directly (PowerShell: npx.cmd --yes @afbin/cli@latest setup${afbinServerFlag(origin, true)}). For Node only, use ${origin}/chat/install-node.sh with bash and reopen your terminal, or run ${origin}/chat/install-node.ps1 inline in PowerShell.` },
    ] },
    { id: 'learn', title: 'Read the local guide', blocks: [
      { kind: 'text', text: 'Restart your coding agent after setup so it loads the installed skill, then ask it to use the artifactbin skill to create or edit an artifact. Run afbin help to discover everything you can do, then afbin help <topic> for the task you are working on.' },
      { kind: 'command', label: 'CLI help', language: 'sh', text: 'afbin help' },
    ] },
    { id: 'server', title: 'Use this server', blocks: [
      { kind: 'text', text: `This guide is for ${origin}. ${server ? `Pass --server ${origin} to every afbin server command. The commands below already include it.` : 'This is the default afbin server; no --server flag is needed.'} Local preview and validation do not need a server.` },
    ] },
    { id: 'connect', title: 'Connect your agent', blocks: [
      { kind: 'text', text: 'If you were given an artifact link, replace ARTIFACT_URL with that link in the commands below. Approve access in your browser using the account or guest session that owns the artifact.' },
      { kind: 'command', label: 'Connect to an existing artifact', language: 'sh', text: `afbin auth 'ARTIFACT_URL'${server}` },
      { kind: 'text', text: 'Starting something new? Connect to your account first, then create and push a JSX file.' },
      { kind: 'command', label: 'Connect to your account', language: 'sh', text: `afbin auth${server}` },
      { kind: 'text', text: 'Server commands also request browser approval automatically when needed. In automation, add --yes --json and open the returned approval URL to continue. Guest browser approval is supported by the CLI; direct HTTP clients use email authentication.' },
    ] },
    { id: 'edit', title: 'Make your first edit', blocks: [
      { kind: 'text', text: 'Pull the supplied artifact into a local file, edit it, and push it back to the same link. Preserve its identity and selected page type. Push validates the file before publishing.' },
      { kind: 'command', label: 'Pull the artifact', language: 'sh', text: `afbin pull 'ARTIFACT_URL' --output artifact.jsx${server}` },
      { kind: 'text', text: 'After editing artifact.jsx, preview it locally, then publish the change.' },
      { kind: 'command', label: 'Preview locally', language: 'sh', text: 'afbin preview artifact.jsx' },
      { kind: 'command', label: 'Publish your edit', language: 'sh', text: `afbin push artifact.jsx${server}` },
    ] },
  ];
  return {
    title: 'Getting started',
    intro: 'Set up afbin, connect your coding agent, and create or edit your first artifact.',
    sections,
  };
}

export function gettingStartedMarkdown(base: string): string {
  const guide = gettingStarted(base);
  return `# ${guide.title}\n\n${guide.intro}\n\n` + guide.sections.map((section, index) =>
    `## ${index + 1}. ${section.title}\n\n` + section.blocks.map(block => block.kind === 'text' ? block.text
      : `${block.label}\n\n\`\`\`${block.language}\n${block.text}\n\`\`\``).join('\n\n'),
  ).join('\n\n') + '\n';
}
