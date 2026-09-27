/** The `dialog` kit chunk: the artifact dialog, its `open` bound to a Value and its form to a `<Mutation>`. */
import { useContext, useSyncExternalStore } from 'react';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/kit/dialog';
import { refName } from '@/lib/story/dataflow';
import { refusalText } from '@/lib/story/sign-in-required';
import { NO_SUBSCRIBE, RuntimeEmbedContext, useBindingReader } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

function DialogAdapter(props: Record<string, unknown>) {
  const {state, setValue} = useContext(RuntimeEmbedContext);
  const name = typeof props.open === 'string' ? refName(props.open) : null;
  return <Dialog {...props} open={name ? state.values[name] === true : typeof props.open === 'boolean' ? props.open : undefined}
    onOpenChange={name ? open => setValue(name, open) : undefined} />;
}

function DialogContentAdapter(props: Record<string, unknown>) {
  const {store, chrome} = useContext(RuntimeEmbedContext);
  const read = useBindingReader();
  const name = typeof props.run === 'string' ? refName(props.run) : null;
  const unavailable = useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE,
    () => name ? store?.mutationUnavailable(name) ?? (store ? null : 'Checking edit access…') : null,
    () => name ? 'Checking edit access…' : null);
  const reason = !chrome && name ? 'Read-only preview' : unavailable;
  const {args, ...rest} = props;
  return <DialogContent {...rest} unavailable={refusalText(reason)}
    onSubmitMutation={name && store ? () => store.mutate(name, read(args)) : undefined} />;
}

export const chunk: KitChunk = {
  faces: { Dialog, DialogTrigger, DialogContent, DialogClose },
  live: { Dialog: DialogAdapter, DialogContent: DialogContentAdapter },
};
