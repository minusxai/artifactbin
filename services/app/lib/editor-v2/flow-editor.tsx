'use client';

/** A continuous prose region. React owns its boundary; ProseMirror (lib/editor-v2/flow-view) owns its descendants. */
import { useLayoutEffect, useRef, useState } from 'react';
import { serializeJsx } from '@/lib/jsx';
import { mountFlowView, type FlowEditorProps, type FlowView } from './flow-view';

export type { FlowEditorProps } from './flow-view';

export function FlowEditor(props: FlowEditorProps) {
  const [compositionEpoch, setCompositionEpoch] = useState(0);
  const mount = useRef<HTMLDivElement>(null);
  const flow = useRef<FlowView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const incoming = serializeJsx(props.nodes);
  useLayoutEffect(() => {
    flow.current = mountFlowView(mount.current!, () => latest.current, () => setCompositionEpoch((n) => n + 1));
    return () => { flow.current?.destroy(); flow.current = null; };
  }, []);
  useLayoutEffect(() => {
    flow.current?.sync(props.nodes);
  }, [incoming, props.nodes, props.path, compositionEpoch]);
  return <div ref={mount} className="mx-prose-region" style={{ display: 'contents' }} />;
}
