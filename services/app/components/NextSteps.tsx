'use client';

/**
 * The dashboard's one permanent front door. Connecting an agent IS the
 * product, so the strip always leads a signed-in home and unfolds in place.
 * Manual token claiming and data uploads live on /account, where account
 * management belongs; they are not competing dashboard calls to action.
 *
 * Signed out, the login form follows the connector. `connectOnly` suppresses
 * that auth stage when this strip is used above an established signed-in
 * workspace.
 */
import { Cable } from 'lucide-react';
import { useState } from 'react';
import GetStarted, { AGENT_MARKS } from '@/components/GetStarted';
import LoginForm from '@/components/LoginForm';
import { LINK } from '@/components/ui';

type Panel = 'connect';

const TITLE = 'tracking-[0.14em] text-fg uppercase';
/** The strip's second row: the one-liner left, the CTA flushed right. */
const FOOT = 'mt-1.5 flex w-full items-baseline justify-between gap-3';
const DESC = 'text-muted';
const CTA = `shrink-0 ${LINK}`;
const STAGE = 'reveal mt-3 rounded-[6px] border border-edge bg-surface px-4 pt-4 pb-4';

export default function NextSteps({
  signedIn = true,
  defaultOpen = null,
  connectOnly = false,
}: {
  signedIn?: boolean;
  defaultOpen?: Panel | null;
  /** Keep only the product's front door; used above an established shelf. */
  connectOnly?: boolean;
}) {
  const [open, setOpen] = useState<Panel | null>(defaultOpen);
  const toggle = (p: Panel) => setOpen((cur) => (cur === p ? null : p));
  const edge = (active: boolean) =>
    active ? 'border-accent' : 'border-edge hover:border-edge-bright';

  return (
    <section aria-label={connectOnly ? 'Connect agent' : 'Next steps'}>
      {/* The hero: its panel unfolds INSIDE the card, so open it reads as one
        * object — a door swung open, not a card with a drawer elsewhere. */}
      <div className={`rounded-[6px] border bg-surface transition-colors ${edge(open === 'connect')}`}>
        <button
          aria-label="Connect an agent"
          aria-expanded={open === 'connect'}
          onClick={() => toggle('connect')}
          className="flex w-full cursor-pointer flex-col px-4 py-3.5 text-left font-mono text-[11px]"
        >
          <span className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <Cable size={16} className="shrink-0 text-accent" />
              <span className={`text-sm ${TITLE}`}>connect an agent</span>
            </span>
            {/* Closed, the agents themselves ride the title row at full
              * presence; open, the panel's brand bars take over. */}
            {open !== 'connect' && (
              <span aria-hidden className="flex shrink-0 items-center gap-2.5 text-fg sm:gap-3">
                {AGENT_MARKS.map((mark) => (
                  <mark.icon key={mark.key} size={mark.iconSize} />
                ))}
              </span>
            )}
          </span>
          <span className={FOOT}>
            <span className={DESC}>a live doc for any agent</span>
            <span className={CTA}>{open === 'connect' ? 'close ↑' : 'connect agent →'}</span>
          </span>
        </button>
        {open === 'connect' && (
          <div key="connect" className="reveal border-t border-edge px-4 pt-4 pb-4">
            {signedIn && !connectOnly ? (
              <p className="font-mono text-xs leading-relaxed text-muted">
                Get a token, paste it into your agent, then ask it to create or edit an artifact.{' '}
                <a href="/tokens/new" aria-label="Get a token for an agent" className={LINK}>get a token →</a>
              </p>
            ) : (
              <GetStarted heading={false} frame={false} />
            )}
          </div>
        )}
      </div>
      {!connectOnly && !signedIn && (
        <div className={STAGE}>
          <h2 className={TITLE}>log in</h2>
          <LoginForm />
        </div>
      )}
    </section>
  );
}
