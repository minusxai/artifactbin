import {useSetupDeployment} from '../lib/deployment-setup';
import {deploymentSetupOptions} from '@/lib/serving/setup-installers';
import { buildSetupInstructions } from '@/lib/skills/setup-instructions';
/* @jsxImportSource solid-js */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { DEFAULT_SERVER, type ArtifactDestination } from '@artifactbin/contracts';
import { ClaudeCodeIcon, CodexIcon, OpenCodeIcon, PiIcon } from '../ui/brand-icons';
import { CopyBlock } from '../ui/CopyBlock';
import { AgentLink } from './AgentLink';
import { Badge, LINK } from '../ui/ui';
import { Panel } from '../ui/Panel';
import { gettingStarted } from '@/lib/serving/getting-started';

const AGENTS = [
  { key: 'claude-code', label: 'Claude Code', icon: ClaudeCodeIcon, size: 13 },
  { key: 'codex', label: 'Codex', icon: CodexIcon, size: 15 },
  { key: 'pi', label: 'pi', icon: PiIcon, size: 16 },
  { key: 'opencode', label: 'OpenCode', icon: OpenCodeIcon, size: 13 },
] as const;
function Step(props: { n: number; title: JSX.Element; aside?: JSX.Element; children: JSX.Element }): JSX.Element { return <div><div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 class="font-mono text-xs font-semibold text-fg"><span class="text-accent">Step {props.n}</span><span aria-hidden="true" class="mx-2 font-normal text-faint">·</span>{props.title}</h3>{props.aside}</div>{props.children}</div>; }

export default function GetStarted(props: { heading?: boolean; frame?: boolean; destination?: ArtifactDestination }): JSX.Element {
  const deployment=useSetupDeployment();
  const [origin, setOrigin] = createSignal('');
  onMount(() => { setOrigin(window.location.origin); });
  const installOrigin = () => origin() || DEFAULT_SERVER;
  const skill=()=>gettingStarted(installOrigin(),deployment()).sections.find(section=>section.id==='skill')!;
  const content = <>
    <Show when={props.heading !== false}><div class="mb-4 flex items-baseline justify-between gap-3"><h2 class="font-mono text-2xs tracking-[0.14em] text-muted uppercase">get started</h2><a href="/getting-started" class={`font-mono text-2xs ${LINK}`}>full guide →</a></div></Show>
    <Step n={1} title="Add the author skill">
      <p class="mt-2 text-xs text-muted">{skill().blocks[0]!.text}</p>
      <a href="/skills/artifactbin.zip" class={`mt-2 inline-block text-sm ${LINK}`}>Download author skill</a>
      <p class="mt-2 text-xs text-muted">Add the artifactbin folder to your harness skill directory and restart the harness. <a href="/getting-started" class={LINK}>Installation instructions</a></p>
      <div class="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5"><span class="mr-0.5 font-sans text-sm text-muted">works with</span><For each={AGENTS}>{agent => <Badge><span class="inline-flex items-center gap-1.5"><agent.icon size={agent.size} />{agent.label}</span></Badge>}</For></div>
    </Step>
    <Show when={deployment()?.mode==='company'}><CopyBlock class="mt-4" text={buildSetupInstructions({serverOrigin:installOrigin(),...deploymentSetupOptions(deployment())})} label="Copy deployment setup instructions" /></Show>
    <div class="mt-5"><Step n={2} title="Copy the instructions" aside={<p class="ml-auto text-right font-sans text-sm leading-relaxed text-muted">Paste into your agent and watch it cook.</p>}><div class="mt-2"><AgentLink destination={props.destination} frame={false} docsLink={false} /></div></Step></div>
  </>;
  return <section aria-label="Get started"><Show when={props.frame !== false} fallback={<div>{content}</div>}><Panel padding="sm" class="sm:px-5">{content}</Panel></Show></section>;
}
