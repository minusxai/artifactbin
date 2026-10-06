/* @jsxImportSource solid-js */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { ClaudeCodeIcon, CodexIcon, OpenCodeIcon, PiIcon } from './brand-icons';
import { CopyBlock } from './CopyBlock';
import { AgentLink } from './AgentLink';
import { LINK } from './ui';
import { gettingStarted } from '@/lib/serving/getting-started';

const AGENTS = [
  { key: 'claude-code', label: 'Claude Code', icon: ClaudeCodeIcon, size: 13 },
  { key: 'codex', label: 'Codex', icon: CodexIcon, size: 15 },
  { key: 'pi', label: 'pi', icon: PiIcon, size: 16 },
  { key: 'opencode', label: 'OpenCode', icon: OpenCodeIcon, size: 13 },
] as const;
function Step(props: { n: number; title: JSX.Element; aside?: JSX.Element; children: JSX.Element }): JSX.Element { return <div><div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 class="font-mono text-[13px] font-semibold text-fg"><span class="text-accent">Step {props.n}</span><span aria-hidden="true" class="mx-2 font-normal text-faint">·</span>{props.title}</h3>{props.aside}</div>{props.children}</div>; }

export default function GetStarted(props: { heading?: boolean; frame?: boolean }): JSX.Element {
  const [origin, setOrigin] = createSignal('');
  const [windows, setWindows] = createSignal(false);
  onMount(() => { setOrigin(window.location.origin); setWindows(/^Win/i.test(window.navigator.platform)); });
  const installOrigin = () => origin() || DEFAULT_SERVER;
  const install = () => gettingStarted(installOrigin()).sections[0]!;
  const command = (language: 'sh' | 'powershell') => install().blocks.find(block => block.kind === 'command' && block.language === language)!.text;
  const unix = <CopyBlock class="mt-2" text={command('sh')} label="Copy the CLI install command" />;
  const windowsInstructions = <><p class="mt-2 text-xs text-muted">Windows · PowerShell</p><CopyBlock class="mt-2" text={command('powershell')} label="Copy the Windows CLI install command" /></>;
  return <section aria-label="Get started"><div class={props.frame === false ? undefined : 'rounded-[6px] border border-edge bg-surface px-4 py-4 sm:px-5'}>
    <Show when={props.heading !== false}><div class="mb-4 flex items-baseline justify-between gap-3"><h2 class="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">get started</h2><a href="/getting-started" class={`font-mono text-[11px] ${LINK}`}>full guide →</a></div></Show>
    <Step n={1} title={install().title}>
      <Show when={windows()} fallback={<>{unix}<details class="mt-3"><summary class="cursor-pointer text-xs text-muted hover:text-fg">See Windows instructions</summary>{windowsInstructions}</details></>}>
        {windowsInstructions}<p class="mt-3 text-xs text-muted">macOS / Linux</p>{unix}
      </Show>
      <p class="mt-2 text-xs text-muted">{install().blocks[0]!.text}</p>
      <div class="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5"><span class="mr-0.5 font-sans text-[13px] text-muted">also installs skills for</span><For each={AGENTS}>{agent => <span class="inline-flex items-center gap-1.5 rounded-[4px] border border-edge bg-raised px-2 py-1 font-mono text-[11px] leading-none text-fg"><agent.icon size={agent.size} />{agent.label}</span>}</For></div>
    </Step>
    <div class="mt-5"><Step n={2} title="Copy the instructions" aside={<p class="ml-auto text-right font-sans text-[13px] leading-relaxed text-muted">Paste into your agent and watch it cook.</p>}><div class="mt-2"><AgentLink frame={false} docsLink={false} /></div></Step></div>
  </div></section>;
}
