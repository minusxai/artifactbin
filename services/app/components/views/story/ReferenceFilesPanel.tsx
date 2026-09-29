/** A read-only index of referenced files. Dataset references belong in Data. */
export default function ReferenceFilesPanel({ refs }: {
  refs: ReadonlyArray<{ id: string; kind: string; title?: string | null }>;
}) {
  const files = [...new Map(refs.filter(ref => ref.kind !== 'dataset').map(ref => [ref.id, ref])).values()];
  const labels: Record<string, string> = { image: 'Image', pdf: 'PDF', file: 'File', asset: 'Asset', viz: 'Visualization' };
  return <section>
    <h2 className="mb-3 font-mono text-sm font-semibold text-fg">Files</h2>
    {files.length === 0 ? <p className="text-sm text-muted">No referenced files.</p> : (
      <div className="overflow-x-auto rounded-[4px] border border-edge">
        <table aria-label="Referenced files" className="w-full border-collapse text-left font-mono text-xs">
          <thead className="bg-raised text-[11px] text-muted"><tr>
            <th scope="col" className="border-b border-edge px-3 py-2 font-medium">File</th>
            <th scope="col" className="border-b border-edge px-3 py-2 font-medium">Type</th>
          </tr></thead>
          <tbody>{files.map(file => <tr key={file.id} className="border-b border-edge last:border-b-0">
            <th scope="row" className="px-3 py-3 font-normal"><a href={`/a/${file.id}`} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">{file.title || file.id}</a></th>
            <td className="px-3 py-3 text-muted">{labels[file.kind] ?? file.kind}</td>
          </tr>)}</tbody>
        </table>
      </div>
    )}
  </section>;
}
