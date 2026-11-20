/* @jsxImportSource solid-js */
import { createSignal, type JSX } from 'solid-js';
import Heart from 'lucide-solid/icons/heart';
import { loginHref } from '@/lib/http/login-href';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { sendReaction } from './reactions';

interface LikeActionProps {
  id: string; accountSession: boolean; initial: { liked: boolean; count: number };
  unavailable?: boolean;
  onChange?: (state: { liked: boolean; count: number }) => void;
  navigate?: (href: string) => void;
}
export function LikeAction(props: LikeActionProps): JSX.Element {
  const [changed, setState] = createSignal<LikeActionProps['initial']>();
  const state = () => changed() ?? props.initial;
  const [busy, setBusy] = createSignal(false);
  const navigate = (href: string) => (props.navigate ?? (target => location.assign(target)))(href);
  const toggle = async () => {
    if (busy() || props.unavailable) return;
    if (!props.accountSession) { navigate(loginHref(location, 'like')); return; }
    setBusy(true);
    // The bar's like press sends through the same door (./reactions): a sign-in refusal goes to login.
    const answer = await sendReaction<{ liked: boolean; count: number }>(`/api/my/artifacts/${encodeURIComponent(props.id)}/like`, state().liked, 'like', navigate);
    setBusy(false);
    if (answer) { setState(answer); props.onChange?.(answer); }
  };
  return <Tooltip content={state().liked ? 'unlike' : 'like'}><Button variant="ghost" size="sm" pressed={state().liked} aria-label={state().liked ? 'Unlike artifact' : 'Like artifact'} disabled={busy() || props.unavailable} onClick={() => void toggle()} class="w-full justify-start"><Heart size={14} fill={state().liked ? 'currentColor' : 'none'} />{state().count}</Button></Tooltip>;
}
