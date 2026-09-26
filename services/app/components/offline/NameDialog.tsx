/**
 * "What should we call you?" — asked once, the first time someone comments,
 * replies or edits in an offline file (components/offline/OfflineApp). The
 * name goes on their comments and into the file's list of changes, so the
 * next person the file is sent to can see who did what.
 *
 * The kit's own chrome (components/ui Input and Button) in the trusted layer,
 * with the ConfirmDialog behaviour: modal, focus kept inside, Escape dismisses.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from '@/components/ui';
import { useTrustedPortalContainer } from '@/components/TrustedUi';

export const NAME_QUESTION = 'What should we call you?';

export function NameDialog({ initial, onSave, onCancel }: {
  initial: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const container = useTrustedPortalContainer();
  const [value, setValue] = useState(initial ?? '');
  const panel = useRef<HTMLFormElement>(null);
  const heading = useId();
  const hint = useId();
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const root = panel.current?.getRootNode() as Document | ShadowRoot | undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel.current(); return; }
      if (event.key !== 'Tab') return;
      const stops = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? [])];
      const first = stops[0], last = stops.at(-1);
      if (!first || !last) return;
      const active = root?.activeElement;
      if (!panel.current?.contains(active ?? null) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const name = value.trim().slice(0, 60);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name) onSave(name);
  };
  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 p-4">
      <form ref={panel} role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={hint} onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-edge-bright bg-surface p-6 font-sans text-fg shadow-2xl">
        <h2 id={heading} className="text-base font-semibold">{NAME_QUESTION}</h2>
        <p id={hint} className="mt-2 text-sm leading-relaxed text-muted">
          Your name goes on your comments and on the list of changes in this file, so whoever you send it to can see who did what.
        </p>
        <label className="mt-4 block text-xs text-muted">
          Your name
          <Input aria-label="Your name" className="mt-1" value={value} maxLength={60} autoComplete="name" onChange={(event) => setValue(event.target.value)} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Not now</Button>
          <Button type="submit" disabled={!name}>Save</Button>
        </div>
      </form>
    </div>,
    container ?? document.body,
  );
}
