/* @jsxImportSource solid-js */
/**
 * THE SINGLE-CHOICE BUTTON ROW: a `role="group"` of pressed-state Buttons, exactly one pressed (a document's
 * visibility, a dataset's writes, a colour mode). Unlike Tabs each option stays a button that acts at once.
 * An option takes an `icon`, an `ariaLabel` when its name differs from its text, a `tooltip`, and
 * `tone: 'caution'` to tint its pressed state with the caution colour. `fill` stretches the options evenly.
 * Options render with <Index>: callers rebuild the array (and its objects) on every reactive read, and <For> keys
 * by object identity, so it would recreate every button; <Index> keeps each button and updates its fields in place.
 * The buttons are `type="button"`, so a group inside a form never submits it.
 */
import { Index, Show, type JSX } from 'solid-js';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import type { ControlSize } from './control-styles';

interface ToggleOption { value: string; label: string; ariaLabel?: string; icon?: () => JSX.Element; tooltip?: JSX.Element; tone?: 'accent' | 'caution'; disabled?: boolean }

export function ToggleGroup(props: { label: string; options: ToggleOption[]; value: string; onChange: (value: string) => void; size?: ControlSize; fill?: boolean; iconOnly?: boolean; class?: string }): JSX.Element {
  return <div role="group" aria-label={props.label} class={`flex gap-1 ${props.class ?? ''}`}>
    <Index each={props.options}>{(entry) => {
      const option = () => entry();
      const button = <Button size={props.size ?? 'sm'} type="button" variant={option().tone === 'caution' ? 'caution' : 'secondary'} pressed={option().value === props.value}
        icon={props.iconOnly ? true : undefined as never} aria-label={option().ariaLabel ?? option().label} disabled={option().disabled}
        onClick={() => { if (option().value !== props.value) props.onChange(option().value); }} class={props.fill ? 'flex-1' : ''}>
        <Show when={option().icon}>{(icon) => <span aria-hidden="true" class="inline-flex">{icon()()}</span>}</Show>
        <Show when={!props.iconOnly}>{option().label}</Show>
      </Button>;
      return <Show when={option().tooltip ?? (props.iconOnly ? option().label : undefined)} fallback={button}>{(tip) => <Tooltip content={tip()}>{button}</Tooltip>}</Show>;
    }}</Index>
  </div>;
}
