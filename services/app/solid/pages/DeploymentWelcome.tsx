/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { agentDiscovery, AGENT_HELP_TITLE } from '@/lib/skills/agent-discovery';
import type { DeploymentState } from '@artifactbin/contracts';
import { buildSetupInstructions } from '@/lib/skills/setup-instructions';
import { deploymentSetupOptions } from '@/lib/agent-copy/setup-installers';
import { HOME_WORKSPACE_COLUMN } from '../components/WorkspaceLayout';
import { PageHeader } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { CopyBlock } from '../ui/CopyBlock';
import { Disclosure } from '../ui/Disclosure';

/** Public deployment configuration only: private shelves remain in the signed-in Home bootstrap. */
export function DeploymentWelcome(props: { deployment: DeploymentState }): JSX.Element {
 const options=()=>({serverOrigin:window.location.origin,...deploymentSetupOptions(props.deployment)});
 const discovery=()=>agentDiscovery(window.location.origin);
 return <main class={HOME_WORKSPACE_COLUMN}><div class="workspace-page space-y-6">
  <PageHeader title="Set up this workspace" description="Connect your coding agent to this deployment, then sign in with your own email." actions={<a href="/login" class="text-accent">Sign in</a>}/>
  <Panel title="AI agents">
   <a href={discovery().url} class="text-accent">{AGENT_HELP_TITLE}</a>
  </Panel>
  <Panel title="Add the author skill">
   <p class="text-sm leading-relaxed text-muted">Download the author skill, add it to your coding agent, then sign in with your own email through the HTTP guide.</p>
   <a href="/skills/artifactbin.zip" class="text-accent">Download author skill</a>
   <p class="mt-3 text-sm text-muted"><a href="/getting-started" class="text-accent">Skill installation and documentation</a></p>
   <Show when={!options().groupHandle}><p class="mt-3 text-sm text-muted">The deployment owner must sign in and confirm the company group before a group can be included here.</p></Show>
  </Panel>
  <Panel title="Set up your coding agent">
   <p class="text-sm leading-relaxed text-muted">Copy these instructions into your agent. Each colleague signs in independently and must accept an invitation to access the group. Their permissions determine whether they can publish, edit, or comment.</p>
   <Disclosure summary="Agent setup instructions" class="mt-3"><CopyBlock text={buildSetupInstructions(options())} label="Copy agent setup instructions" size="lg"/></Disclosure>
  </Panel>
 </div></main>;
}
