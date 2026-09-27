/** The `deck-gl` kit chunk: `<DeckGL>`, a map over a declared table. The map engine is a further chunk of its own. */
import { useContext, type ComponentType } from 'react';
import { DeckGLMap } from '@/components/kit/deck-gl';
import { refName } from '@/lib/story/dataflow';
import { RuntimeEmbedContext, runtimeTargetIdentity } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

function DeckGLAdapter(props: Record<string, unknown>) {
  const { colorMode, state } = useContext(RuntimeEmbedContext);
  const name = refName(props.data);
  // The identity lands on the adapter's own box; the map inside must not repeat it.
  const { id: _id, 'data-mx-ast': _ast, ...mapProps } = props;
  return (
    <div {...runtimeTargetIdentity(props)}>
      <DeckGLMap {...(mapProps as unknown as Parameters<typeof DeckGLMap>[0])} rows={name ? state.tables[name]?.rows ?? [] : []} colorMode={colorMode} />
    </div>
  );
}

export const chunk: KitChunk = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  faces: { DeckGL: DeckGLMap as unknown as ComponentType<any> },
  live: { DeckGL: DeckGLAdapter },
};
