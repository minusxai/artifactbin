/** The `iframe` kit chunk: `<Iframe>`, an author's managed frame with the document's store behind it. */
import { useContext } from 'react';
import { IframeFace } from '@/lib/story-ui/iframe-face';
import type { ManagedIframeContent } from '@/lib/story/managed-iframe';
import { ManagedIframeView } from '../managed-iframe';
import { RuntimeEmbedContext } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

function IframeAdapter(props: Record<string, unknown>) {
  const { store, managedAssets, importManagedAsset } = useContext(RuntimeEmbedContext);
  return store ? <ManagedIframeView {...props} compiled={props.compiled as ManagedIframeContent} store={store} assets={managedAssets} importAsset={importManagedAsset} /> : null;
}

export const chunk: KitChunk = { faces: { Iframe: IframeFace }, live: { Iframe: IframeAdapter } };
