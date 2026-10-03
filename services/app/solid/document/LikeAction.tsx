/* @jsxImportSource solid-js */
import { createSignal, type JSX } from 'solid-js';
import Heart from 'lucide-solid/icons/heart';
import { loginHref } from '@/lib/http/login-href';
import { Tooltip } from '../components/Tooltip';
import { sendReaction } from './reactions';

export interface LikeActionProps {
  id: string; accountSession: boolean; initial: { liked: boolean; count: number };
  onChange?: (state: { liked: boolean; count: number }) => void;
  navigate?: (href: string) => void;
}
export function LikeAction(props: LikeActionProps): JSX.Element {
  const [state, setState] = createSignal(props.initial);
  const [busy, setBusy] = createSignal(false);
  const navigate = (href: string) => (props.navigate ?? (target => location.assign(target)))(href);
  const toggle = async () => {
    if (!props.accountSession) { navigate(loginHref(location, 'like')); return; }
    if (busy()) return;
    setBusy(true);
    // The bar's like press sends through the same door (./reactions): a sign-in refusal goes to login.
    const answer = await sendReaction<{ liked: boolean; count: number }>(`/api/my/artifacts/${encodeURIComponent(props.id)}/like`, state().liked, 'like', navigate);
    setBusy(false);
    if (answer) { setState(answer); props.onChange?.(answer); }
  };
  return <Tooltip content={state().liked ? 'unlike' : 'like'}><button type="button" aria-label={state().liked ? 'Unlike artifact' : 'Like artifact'} aria-pressed={state().liked} disabled={busy()} onClick={() => void toggle()} class="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-muted hover:text-accent"><Heart size={14} fill={state().liked ? 'currentColor' : 'none'} />{state().count}</button></Tooltip>;
}
