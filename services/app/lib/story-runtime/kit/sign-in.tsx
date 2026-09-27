/** The `sign-in` kit chunk: `<SignIn>`, the guest's door. */
import { useContext, type ReactNode } from 'react';
import { SignIn } from '@/components/kit/sign-in';
import { RuntimeEmbedContext } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

/**
 * `<SignIn>` LIVE: the guest's door, and nothing at all for anyone else.
 *
 * A signed-in reader has no use for it and a document that shows it to them is
 * simply wrong, so the branch is taken HERE rather than left to the author —
 * `{$_me ? … : <SignIn/>}` is the idiom, but `<SignIn>` alone must also be
 * honest. Decided from the island, so the server render and the hydration agree.
 */
function SignInAdapter(props: Record<string, unknown>) {
  const { viewer } = useContext(RuntimeEmbedContext);
  if (viewer) return null;
  const { children, ...rest } = props;
  return <SignIn {...rest}>{children as ReactNode}</SignIn>;
}

export const chunk: KitChunk = { faces: { SignIn }, live: { SignIn: SignInAdapter } };
