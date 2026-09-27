/** The `mermaid` kit chunk: `<Mermaid>`, drawn in the document's colour mode. The diagram engine is a further chunk per kind. */
import { useContext } from 'react';
import { Mermaid } from '@/components/kit/mermaid';
import { RuntimeEmbedContext } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

function MermaidAdapter(props: Record<string, unknown>) {
  const { colorMode } = useContext(RuntimeEmbedContext);
  return <Mermaid {...props} code={props.code as string} colorMode={colorMode} />;
}

export const chunk: KitChunk = { faces: { Mermaid }, live: { Mermaid: MermaidAdapter } };
