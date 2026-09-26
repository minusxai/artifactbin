'use client';
/**
 * A CONTROL THAT EXISTS ONLY FOR A BACKEND FEATURE (lib/artifact-backend):
 * when the backend says the feature is unavailable, the control stays where it
 * is, disabled, and says why — as its accessible description and as a tooltip
 * on a focusable wrapper (a disabled control receives neither focus nor
 * pointer events, so it cannot open a tooltip itself; the same pattern as the
 * runtime's MutationCellHint). With no reason nothing is wrapped: online, the
 * control renders exactly as it always has.
 */
import { useId, type ReactElement } from 'react';
import { Tooltip } from './Tooltip';

export interface UnavailableProps { disabled?: true; 'aria-describedby'?: string }

export function FeatureGate({ reason, className = 'inline-flex', children }: {
  /** `backend.unavailable(feature)`: null when the feature works. */
  reason: string | null;
  /** The wrapper's layout, when the control is not inline. */
  className?: string;
  /** Spread these onto the control. */
  children: (unavailable: UnavailableProps) => ReactElement;
}) {
  const id = useId();
  if (!reason) return children({});
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} data-feature-unavailable="" className={`${className} [&>:disabled]:pointer-events-none`}>
        {children({ disabled: true, 'aria-describedby': id })}
        <span id={id} hidden>{reason}</span>
      </span>
    </Tooltip>
  );
}
