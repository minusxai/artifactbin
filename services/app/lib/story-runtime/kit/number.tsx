/** The `number` kit chunk: `<Number>`, one figure aggregated from a declared table. */
import { useContext } from 'react';
import InlineNumber, { type NumberAgg } from '@/components/views/story/InlineNumber';
import { refName } from '@/lib/story/dataflow';
import { RuntimeEmbedContext, runtimeTargetIdentity } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

function NumberAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  const table = refName(props.data);
  const busy = table !== null && ctx.pending.has(table);
  // The figure stays while its query re-runs (no flash to a dash); the wrapper
  // says so — dimmed by the embed CSS, announced by aria-busy.
  return (
    <span {...runtimeTargetIdentity(props)} aria-busy={busy} className={busy ? 'mx-busy-inline' : undefined}>
      <InlineNumber
        data={props.data}
        col={typeof props.col === 'string' ? props.col : undefined}
        agg={typeof props.agg === 'string' ? (props.agg as NumberAgg) : undefined}
        prefix={typeof props.prefix === 'string' ? props.prefix : undefined}
        suffix={typeof props.suffix === 'string' ? props.suffix : undefined}
        format={typeof props.format === 'string' ? props.format : undefined}
        tables={ctx.state.tables}
      />
    </span>
  );
}

export const chunk: KitChunk = { faces: {}, live: { Number: NumberAdapter } };
