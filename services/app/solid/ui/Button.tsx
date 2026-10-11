/* @jsxImportSource solid-js */
/**
 * THE APP'S BUTTON. A native <button> — every native prop (type, disabled, aria-*, form, handlers) passes
 * through — drawn in one of five variants at one of the two control sizes. `class` is for layout only
 * (width, flex, margin); look belongs to the variant. `icon` makes it square for an icon-only button,
 * which must carry an aria-label.
 */
import { splitProps, type JSX } from 'solid-js';
import { CONTROL_SIZE, DISABLED, FOCUS_RING, ICON_SIZE, type ControlSize } from './control-styles';

const VARIANT = {
  primary: 'border border-action bg-action font-semibold text-action-ink hover:brightness-95',
  secondary: 'border border-edge-bright bg-surface font-medium text-fg hover:border-accent hover:bg-raised',
  danger: 'border border-edge-bright bg-surface font-medium text-danger hover:border-danger hover:bg-danger-soft focus-visible:ring-danger/30',
  ghost: 'border border-transparent bg-transparent font-medium text-muted hover:bg-raised hover:text-fg',
  link: 'border-0 bg-transparent font-medium text-accent underline-offset-4 hover:underline',
} as const;

type ButtonVariant = keyof typeof VARIANT;
type NativeButton = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'class'>;
type ButtonProps = NativeButton & { variant?: ButtonVariant; size?: ControlSize; class?: string } & ({ icon?: false } | { icon: true; 'aria-label': string });

export function Button(props: ButtonProps): JSX.Element {
  const [own, native] = splitProps(props, ['variant', 'size', 'icon', 'class']);
  const variant = () => own.variant ?? 'primary';
  const geometry = () => variant() === 'link' ? 'h-auto px-0 font-sans text-sm' : (own.icon ? ICON_SIZE : CONTROL_SIZE)[own.size ?? 'md'];
  return <button {...native} class={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap ${geometry()} ${VARIANT[variant()]} ${FOCUS_RING} ${DISABLED} ${own.class ?? ''}`} />;
}
