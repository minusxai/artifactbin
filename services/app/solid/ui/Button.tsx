/* @jsxImportSource solid-js */
/**
 * THE APP'S BUTTON. A native <button> — every native prop (type, disabled, aria-*, form, handlers) passes
 * through — drawn in one of six variants at one of the control sizes. `class` is for layout only
 * (width, flex, margin); look belongs to the variant. `icon` makes it square for an icon-only button,
 * which must carry an aria-label.
 *
 * With `href` it is a link (<a>) of the same look — `target`, `rel` and `download` pass through, and only a
 * link takes them. A disabled link drops its href and says `aria-disabled`, since an anchor cannot be disabled.
 * With `pressed` it is a toggle (a filter chip, a view switch): `aria-pressed`, unpressed drawn as `secondary`
 * (or `ghost`), pressed tinted with the accent (or the caution colour for `variant="caution"`).
 * A link takes `current` instead when it names the page being shown (a navigation row): `aria-current="page"`,
 * drawn like a pressed toggle — `aria-pressed` would make a link announce itself as a toggle button.
 *
 * `shape="tile"` is a Button around auto-height content (a thumbnail, a specimen card): no control height or
 * padding, its content stretched to the full width, the radius of a chip; the variant's colours still apply
 * (a pressed tile is the accent's). Text controls never take it.
 */
import { splitProps, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CONTROL_SIZE, DISABLED, FOCUS_RING, ICON_SIZE, type ButtonSize } from './control-styles';

const VARIANT = {
  primary: 'border border-action bg-action font-semibold text-action-ink hover:brightness-95',
  secondary: 'border border-edge-bright bg-surface font-medium text-fg hover:border-accent hover:bg-raised',
  danger: 'border border-edge-bright bg-surface font-medium text-danger hover:border-danger hover:bg-danger-soft focus-visible:ring-danger/30',
  caution: 'border border-edge-bright bg-surface font-medium text-caution hover:border-caution hover:bg-caution-soft focus-visible:ring-caution/30',
  ghost: 'border border-transparent bg-transparent font-medium text-muted hover:bg-raised hover:text-fg',
  link: 'border-0 bg-transparent font-medium text-accent underline-offset-4 hover:underline',
} as const;
const PRESSED = {
  accent: 'border border-accent/40 bg-accent-soft font-medium text-accent hover:border-accent',
  caution: 'border border-caution/40 bg-caution-soft font-medium text-caution hover:border-caution focus-visible:ring-caution/30',
} as const;

type ButtonVariant = keyof typeof VARIANT;
type Look = { variant?: ButtonVariant; size?: ButtonSize; class?: string; pressed?: boolean | 'mixed'; shape?: 'tile' };
type Square = { icon?: false } | { icon: true; 'aria-label': string };
type NativeButton = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'class'> & { href?: undefined };
type LinkProps = NativeLink & Look & Square;
type ButtonProps = NativeButton & Look & Square;
type NativeLink = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'class' | 'href'> & { href: string; disabled?: boolean; current?: boolean };

/** The class string of a Button of this look. */
/** A tile's geometry: auto height, no padding, its content stretched across (flex column, items stretched). */
const TILE = 'h-auto min-w-0 flex-col items-stretch overflow-hidden rounded-chip p-0 text-left';
const ROW = 'items-center justify-center gap-2 whitespace-nowrap';

function buttonClass(look: { variant?: ButtonVariant; size?: ButtonSize; icon?: boolean; pressed?: boolean | 'mixed'; shape?: 'tile'; class?: string }): string {
  const variant = look.variant ?? (look.pressed === undefined ? 'primary' : 'secondary');
  const geometry = look.shape === 'tile' ? TILE : `${ROW} ${variant === 'link' ? 'h-auto px-0 font-sans text-sm' : (look.icon ? ICON_SIZE : CONTROL_SIZE)[look.size ?? 'md']}`;
  const tone = look.pressed === undefined ? VARIANT[variant]
    : look.pressed ? PRESSED[variant === 'caution' ? 'caution' : 'accent']
      : VARIANT[variant === 'ghost' ? 'ghost' : 'secondary'];
  return `inline-flex shrink-0 cursor-pointer no-underline transition-colors ${geometry} ${tone} ${FOCUS_RING} ${DISABLED} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${look.class ?? ''}`;
}

// Two signatures, not one union: a union of the two would defeat TypeScript's check of a spread `icon`
// (`{...(square ? { icon: true } : {})}`) against the icon/aria-label pairing.
export function Button(props: LinkProps): JSX.Element;
export function Button(props: ButtonProps): JSX.Element;
export function Button(props: LinkProps | ButtonProps): JSX.Element {
  const [own, native] = splitProps(props as ButtonProps & { href?: string; disabled?: boolean; current?: boolean }, ['variant', 'size', 'icon', 'class', 'pressed', 'shape', 'href', 'disabled', 'current']);
  const link = () => own.href !== undefined;
  // A current link is drawn as a pressed one, but says aria-current, not aria-pressed.
  const look = () => (link() && own.current !== undefined ? { ...own, pressed: own.current } : own);
  return <Dynamic component={link() ? 'a' : 'button'} {...native}
    href={link() && !own.disabled ? own.href : undefined}
    disabled={link() ? undefined : own.disabled}
    aria-disabled={link() && own.disabled ? 'true' : undefined}
    aria-pressed={link() && own.current !== undefined ? undefined : own.pressed}
    aria-current={link() && own.current ? 'page' : undefined}
    class={buttonClass(look())} />;
}
