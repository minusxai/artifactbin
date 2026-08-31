import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/Tooltip';

// App tooltips portal by default so clipped/transformed workspaces cannot offset
// them. Story roots opt out once because foreignObject requires inline content.
function renderTooltip(portalled?: boolean, providerPortalled?: boolean, className?: string) {
  return render(
    // A clipping ancestor, mirroring the question header panel.
    <div aria-label="host" style={{ overflow: 'hidden' }}>
      <TooltipProvider portalled={providerPortalled}>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button aria-label="trigger">badge</button>
          </TooltipTrigger>
          <TooltipContent portalled={portalled} className={className}>
            <span aria-label="tip">Local data — typed or pasted and saved in this question.</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>,
  );
}

describe('Tooltip', () => {
  it('escapes clipping ancestors by default in the app', () => {
    renderTooltip();
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(false);
    expect(tip.closest('[data-mx-theme-host]')).not.toBeNull();
    expect(tip.closest('[data-slot="tooltip-content"]')).toHaveClass('bg-surface', 'text-fg', 'border-edge-bright');
    const arrow = tip.closest('[data-slot="tooltip-content"]')?.querySelector('svg');
    expect(arrow).toHaveClass('fill-surface');
    expect(arrow).toHaveAttribute('stroke', 'var(--color-edge-bright)');
    expect(arrow).toHaveAttribute('stroke-linejoin', 'round');
    expect(arrow).not.toHaveClass('rotate-45', 'bg-foreground');
  });

  it('renders inline when a story provider opts out', () => {
    renderTooltip(undefined, false);
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(true);
    expect(tip.closest('[data-mx-theme-host]')).toBeNull();
  });

  it('allows an exceptional content instance to override its provider', () => {
    renderTooltip(true, false);
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(false);
  });

  /*
   * A caller's class must WIN over the built-in one it collides with. That is
   * what tailwind-merge is for and what a plain join cannot do: both classes
   * survive, and which one paints is then decided by stylesheet order — the
   * exact silent failure a shared primitive must not have.
   */
  it('lets a caller override a built-in utility rather than fighting it', () => {
    renderTooltip(undefined, undefined, 'px-4');
    const content = screen.getByLabelText('tip').closest('[data-slot="tooltip-content"]')!;
    expect(content).toHaveClass('px-4');
    expect(content).not.toHaveClass('px-2.5');
  });
});
