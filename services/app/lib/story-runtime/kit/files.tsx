/** The `files` kit chunk: `<Files>`, a folder's listing bound like every other data embed. */
import { useContext, type ComponentType } from 'react';
import { Files } from '@/components/kit/files';
import { refName } from '@/lib/story/dataflow';
import { RuntimeEmbedContext } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

/**
 * `<Files data="$q">` — a bound LISTING, live. The rows are the store's,
 * exactly like every other bound embed: the document's own <Query> over
 * `ref_<folderId>` runs through the transport its island already names, so the
 * listing follows a child being created or moved with no reload (lib/folders
 * notifyParent wakes the folder's channel, and the store re-runs the query the
 * ping dirties).
 */
function FilesAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  const name = refName(props.data);
  const table = name ? ctx.state.tables[name] : undefined;
  return (
    <Files
      rows={table?.rows}
      variant={typeof props.variant === 'string' ? props.variant : undefined}
      capture={!ctx.chrome}
    />
  );
}

export const chunk: KitChunk = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  faces: { Files: Files as unknown as ComponentType<any> },
  live: { Files: FilesAdapter },
};
