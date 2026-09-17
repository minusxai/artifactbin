/**
 * THE HEADER A NUMBERED STEP WEARS inside the dataset workspace — raw data,
 * data models, whitelist: the step's number as an accent eyebrow, its name,
 * and one sentence on what it is for. One component so the three cards read
 * as one sequence, whichever file draws them.
 */
import type { ReactNode } from 'react';

export default function StepHeader({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <header className="border-b border-edge p-4 sm:p-5">
      <p className="text-[10px] font-medium tracking-widest text-accent uppercase">Step {n}</p>
      <h2 className="mt-0.5 text-sm font-semibold text-fg">{title}</h2>
      {children && <p className="mt-1 text-xs leading-5 text-muted">{children}</p>}
    </header>
  );
}
