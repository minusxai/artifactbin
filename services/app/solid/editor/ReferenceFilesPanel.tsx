/* @jsxImportSource solid-js */
/** A read-only index of referenced files. */
import { For, Show, type JSX } from 'solid-js';

const LABELS: Record<string, string> = { image: 'Image', pdf: 'PDF', file: 'File', asset: 'Asset', viz: 'Visualization' };

export default function ReferenceFilesPanel(props: {
  refs: ReadonlyArray<{ id: string; kind: string; title?: string | null }>;
}): JSX.Element {
  const files = () => [...new Map(props.refs.filter((ref) => ref.kind !== 'dataset').map((ref) => [ref.id, ref])).values()];
  return (
    <section>
      <h2 class="mb-3 font-mono text-sm font-semibold text-fg">Files</h2>
      <Show when={files().length > 0} fallback={<p class="text-sm text-muted">No referenced files.</p>}>
        <div class="overflow-x-auto rounded-[4px] border border-edge">
          <table aria-label="Referenced files" class="w-full border-collapse text-left font-mono text-xs">
            <thead class="bg-raised text-[11px] text-muted">
              <tr>
                <th scope="col" class="border-b border-edge px-3 py-2 font-medium">File</th>
                <th scope="col" class="border-b border-edge px-3 py-2 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              <For each={files()}>
                {(file) => (
                  <tr class="border-b border-edge last:border-b-0">
                    <th scope="row" class="px-3 py-3 font-normal">
                      <a href={`/a/${file.id}`} target="_blank" rel="noreferrer" class="text-accent underline-offset-2 hover:underline">{file.title || file.id}</a>
                    </th>
                    <td class="px-3 py-3 text-muted">{LABELS[file.kind] ?? file.kind}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
