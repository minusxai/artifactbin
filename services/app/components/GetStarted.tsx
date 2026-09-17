'use client';

/**
 * THE FRONT DOOR — two steps, in the order everyone takes them.
 *
 * Step one installs the afbin CLI; the marks under the command name the
 * agents it installs skills for, because that is the agent-specific step.
 * Step two is the solid button (AgentLink): it mints a live document and
 * copies the line to paste into the agent. The numbers are real — the paste
 * asks the agent to use afbin, so the install comes first.
 *
 * The install URL is built from window.location, never hardcoded — the same
 * card serves localhost, staging and production.
 */
import { useEffect, useState } from 'react';
import AgentLink from '@/components/AgentLink';
import { ClaudeCodeIcon, CodexIcon, OpenCodeIcon, PiIcon } from '@/components/brand-icons';
import CopyBlock from '@/components/CopyBlock';
import { LINK } from '@/components/ui';

/** The agents afbin installs local skills for, in the order the CLI names
 * them. Sizes differ because the marks do: pi's glyph sits inside a large
 * viewBox and reads small at the same nominal size. */
const AGENTS = [
  { key: 'claude-code', label: 'Claude Code', icon: ClaudeCodeIcon, size: 13 },
  { key: 'codex', label: 'Codex', icon: CodexIcon, size: 15 },
  { key: 'pi', label: 'pi', icon: PiIcon, size: 16 },
  { key: 'opencode', label: 'OpenCode', icon: OpenCodeIcon, size: 13 },
] as const;

/** The caption that shares a row with a step title: right-aligned on the same
 * baseline, and `ml-auto` keeps it on the right when a narrow column wraps it
 * onto its own line. */
const ASIDE = 'ml-auto text-right font-sans text-[13px] leading-relaxed text-muted';
/** Inline code inside a sentence — MarkdownLite's own treatment, so a command
 * name reads the same here as in a rendered document. */
const CODE = 'rounded-[3px] bg-raised px-1 py-0.5 font-mono text-[0.92em] text-fg';

/** One numbered step: a header row (title left, caption right) and the block
 * under it, all at the host's own padding — no gutter, so the blocks line up
 * with the dialog header above them. The step label is accent because the
 * sequence is the card's structure — it is the one thing here that says
 * "this, then that". */
function Step({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-[13px] font-semibold text-fg">
          <span className="text-accent">Step {n}</span>
          <span aria-hidden className="mx-2 font-normal text-faint">·</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

export default function GetStarted({ heading = true, frame = true }: { heading?: boolean; frame?: boolean }) {
  // Empty until hydration, so server and client render the same relative
  // URL; the absolute one lands with the first client paint.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  return (
    <section aria-label="Get started">
      <div className={frame ? 'rounded-[6px] border border-edge bg-surface px-4 py-4 sm:px-5' : undefined}>
        {heading && (
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">get started</h2>
            <a href="/docs-human" className={`font-mono text-[11px] ${LINK}`}>
              how it works →
            </a>
          </div>
        )}

        <Step
          n={1}
          title={
            <>
              Install the <code className={CODE}>afbin</code> CLI
              {/* Returning readers have done this; the qualifier lets them
                * skip to step 2 without the step pretending it is new. */}
              <span className="font-sans font-normal text-muted">, if you haven&apos;t</span>
            </>
          }
        >
          <CopyBlock
            className="mt-2"
            text={`curl -fsSL ${origin || 'https://artifactbin.dev'}/chat/install.sh | sh`}
            label="Copy the CLI install command"
          />
          {/* WHICH AGENTS, as badges — mark left, name right — under the
            * install command that puts their skills there. The marks stay in
            * brand colour: this is the one place the page shows which agents
            * it speaks to, and a greyed-out logo looks unsupported. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="mr-0.5 font-sans text-[13px] text-muted">also installs skills for</span>
            {AGENTS.map((agent) => (
              <span
                key={agent.key}
                className="inline-flex items-center gap-1.5 rounded-[4px] border border-edge bg-raised px-2 py-1 font-mono text-[11px] leading-none text-fg"
              >
                <agent.icon size={agent.size} />
                {agent.label}
              </span>
            ))}
          </div>
        </Step>

        <div className="mt-5">
          <Step n={2} title="Copy the instructions" aside={<p className={ASIDE}>Paste into your agent and watch it cook.</p>}>
            <div className="mt-2">
              <AgentLink frame={false} docsLink={false} />
            </div>
          </Step>
        </div>
      </div>
    </section>
  );
}
