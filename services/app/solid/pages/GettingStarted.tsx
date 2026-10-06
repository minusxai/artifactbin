/* @jsxImportSource solid-js */
import { For, type JSX } from 'solid-js';
import { gettingStarted } from '@/lib/serving/getting-started';
import { CopyBlock } from '../components/CopyBlock';
import { LINK } from '../components/ui';

export function GettingStartedPage(): JSX.Element {
  const guide = gettingStarted(window.location.origin);
  return <main class="workspace-page">
    <header class="border-b border-edge pb-6">
      <a href="/docs-human" class={`font-mono text-xs ${LINK}`}>Human docs</a>
      <div class="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <h1 class="font-sans text-3xl font-semibold tracking-tight">{guide.title}</h1>
        <a href="/getting-started.md" rel="external" class={`font-mono text-xs ${LINK}`}>Markdown for agents ↗</a>
      </div>
      <p class="mt-3 max-w-xl font-sans text-sm leading-relaxed text-muted">{guide.intro}</p>
    </header>
    <nav aria-label="Getting started contents" class="flex flex-wrap gap-x-5 gap-y-2 border-b border-edge py-4 font-mono text-xs text-muted">
      <For each={guide.sections}>{(section, index) => <a href={`#${section.id}`} class="hover:text-accent"><span class="mr-1.5 text-faint">{index() + 1}.</span>{section.title}</a>}</For>
    </nav>
    <div class="divide-y divide-edge">
      <For each={guide.sections}>{(section, index) => <section id={section.id} class="scroll-mt-20 py-7">
        <h2 class="mb-4 flex items-baseline gap-3 font-sans text-lg font-semibold"><span class="font-mono text-xs text-accent">{String(index() + 1).padStart(2, '0')}</span>{section.title}</h2>
        <div class="space-y-4"><For each={section.blocks}>{block => block.kind === 'text'
          ? <p class="font-sans text-sm leading-relaxed text-muted">{block.text}</p>
          : <div><h3 class="font-mono text-xs text-muted">{block.label}</h3><CopyBlock text={block.text} label={`Copy ${block.label.toLowerCase()} command`} class="mt-2" /></div>
        }</For></div>
      </section>}</For>
    </div>
  </main>;
}
