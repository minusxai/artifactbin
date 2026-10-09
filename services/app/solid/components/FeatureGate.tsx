/* @jsxImportSource solid-js */
/**
 * A CONTROL THAT EXISTS ONLY FOR A BACKEND
 * FEATURE (lib/artifact-backend): when the backend says the feature is unavailable, the
 * control stays where it is, disabled, and says why — as its accessible description and
 * as a tooltip on a focusable wrapper (a disabled control receives neither focus nor
 * pointer events, so it cannot open a tooltip itself). With no reason nothing is wrapped:
 * online, the control renders exactly as it always has.
 */
import { createUniqueId, Show, type JSX } from 'solid-js';
import { Tooltip } from './Tooltip';

interface UnavailableProps { disabled?: true; 'aria-describedby'?: string }

export function FeatureGate(props: {
  /** `backend.unavailable(feature)`: null/undefined when the feature works. */
  reason: string | null | undefined;
  /** The wrapper's layout, when the control is not inline. */
  class?: string;
  children: (unavailable: UnavailableProps) => JSX.Element;
}): JSX.Element {
  const id = createUniqueId();
  return (
    <Show when={props.reason} fallback={props.children({})}>
      {(reason) => (
        <Tooltip content={reason()}>
          <span tabIndex={0} data-feature-unavailable="" class={`${props.class ?? 'inline-flex'} [&>:disabled]:pointer-events-none`}>
            {props.children({ disabled: true, 'aria-describedby': id })}
            <span id={id} hidden>{reason()}</span>
          </span>
        </Tooltip>
      )}
    </Show>
  );
}
