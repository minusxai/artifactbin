/* @jsxImportSource solid-js */
/**
 * THE SINGLE-CHOICE BUTTON ROW: a `role="group"` of pressed-state Buttons, exactly one pressed (a document's
 * visibility, a dataset's writes, a colour mode). Unlike Tabs each option stays a button that acts at once.
 * An option takes an `icon`, an `ariaLabel` when its name differs from its text, a `tooltip`, and
 * `tone: 'caution'` to tint its pressed state with the caution colour. `fill` stretches the options evenly.
 */
import { For, Show, type JSX } from 'solid-js';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import type { ControlSize } from './control-styles';

interface ToggleOption { value: string; label: string; ariaLabel?: string; icon?: () => JSX.Element; tooltip?: JSX.Element; tone?: 'accent' | 'caution'; disabled?: boolean }

export function ToggleGroup(props: { label: string; options: ToggleOption[]; value: string; onChange: (value: string) => void; size?: ControlSize; fill?: boolean; iconOnly?: boolean; class?: string }): JSX.Element {
  return <div role="group" aria-label={props.label} class={`flex gap-1 ${props.class ?? ''}`}>
    <For each={props.options}>{(option) => {
      const button = <Button size={props.size ?? 'sm'} variant={option.tone === 'caution' ? 'caution' : 'secondary'} pressed={option.value === props.value}
        icon={props.iconOnly ? true : undefined as never} aria-label={option.ariaLabel ?? option.label} disabled={option.disabled}
        onClick={() => { if (option.value !== props.value) props.onChange(option.value); }} class={props.fill ? 'flex-1' : ''}>
        <Show when={option.icon}>{(icon) => <span aria-hidden="true" class="inline-flex">{icon()()}</span>}</Show>
        <Show when={!props.iconOnly}>{option.label}</Show>
      </Button>;
      return <Show when={option.tooltip ?? (props.iconOnly ? option.label : undefined)} fallback={button}>{(tip) => <Tooltip content={tip()}>{button}</Tooltip>}</Show>;
    }}</For>
  </div>;
}
