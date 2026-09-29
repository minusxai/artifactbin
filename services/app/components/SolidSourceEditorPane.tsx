'use client';

/** React page chrome owns one Solid source pane until the page shell itself moves to Solid. */
import { useLayoutEffect, useRef } from 'react';
import { batch, createSignal, untrack } from 'solid-js';
import { createComponent, render } from 'solid-js/web';
import SourceEditorPane from '@/solid/editor/SourceEditorPane';
import type { SourceEditorProps } from '@/solid/editor/SourceEditor';

export default function SolidSourceEditorPane(props: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const update = useRef<((next: SourceEditorProps) => void) | null>(null);
  latest.current = props;
  useLayoutEffect(() => {
    if (!host.current) return;
    const [value, setValue] = createSignal(latest.current.value);
    const [revision, setRevision] = createSignal(latest.current.revision);
    const [readOnly, setReadOnly] = createSignal(latest.current.readOnly);
    const [ariaLabel, setAriaLabel] = createSignal(latest.current.ariaLabel);
    const [initialSelection, setInitialSelection] = createSignal(latest.current.initialSelection);
    update.current = (next) => batch(() => {
      setValue(next.value);
      setRevision(next.revision);
      setReadOnly(next.readOnly);
      setAriaLabel(next.ariaLabel);
      setInitialSelection(() => next.initialSelection);
    });
    const emit = (next: string) => latest.current.onChange(next);
    const dispose = render(() => untrack(() => createComponent(SourceEditorPane, {
      get value() { return value(); },
      get revision() { return revision(); },
      get onChange() { return emit; },
      get initialSelection() { return initialSelection(); },
      get readOnly() { return readOnly(); },
      get ariaLabel() { return ariaLabel(); },
    })), host.current);
    return () => { update.current = null; dispose(); };
  }, []);
  useLayoutEffect(() => { update.current?.(props); });
  return <div ref={host} className="h-full" />;
}
