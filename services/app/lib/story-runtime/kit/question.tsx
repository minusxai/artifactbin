/** The `question` kit chunk: `<Question>`, a chart or figure over a declared table. Its chart engine is a further chunk of its own. */
import { useContext } from 'react';
import QuestionEmbed from '@/components/views/story/QuestionEmbed';
import { GridItemContext } from '@/components/kit/grid';
// The leaf module, not story-viz: the <Question> write-back also imports the
// editor's AST path (jsx-edit → lib/jsx → acorn), which drags the JSX parser
// into every reader's download for a number
// (lib/__tests__/reader-bundle-hygiene.test.ts).
import { questionEmbedHeightPx } from '@/lib/data/story/question-height';
import { refName } from '@/lib/story/dataflow';
import { RuntimeEmbedContext, runtimeTargetIdentity } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

function QuestionAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  // The shared question sizing contract — a chart
  // must not change height between editing and reading, and inside a GridItem
  // the CELL is the single source of height: a fixed default here is what
  // clipped every tall recipe (the trend card's sparkline) at the tile edge.
  const inGridItem = useContext(GridItemContext);
  const bare = (props.viz as { kind?: string } | undefined)?.kind === 'single_value';
  const h = questionEmbedHeightPx(props.height, bare);
  // A re-run in flight keeps the current rows on screen (no flash) and says so.
  const table = refName(props.data);
  const busy = table !== null && ctx.pending.has(table);
  return (
    <div
      {...runtimeTargetIdentity(props)}
      aria-label="Question embed"
      aria-busy={busy}
      className={busy ? 'mx-busy' : undefined}
      style={{ width: '100%', height: inGridItem ? '100%' : `${h}px` }}
    >
      <QuestionEmbed
        data={props.data}
        viz={props.viz as Record<string, unknown> | undefined}
        title={typeof props.title === 'string' ? props.title : undefined}
        colorMode={ctx.colorMode}
        tables={ctx.state.tables}
        tableErrors={ctx.state.errors}
        pendingTables={ctx.pending}
        refData={ctx.refData}
      />
    </div>
  );
}

export const chunk: KitChunk = { faces: {}, live: { Question: QuestionAdapter } };
