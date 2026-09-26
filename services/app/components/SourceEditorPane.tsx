import { useEffect, useState } from 'react';
import { FeatureGate } from './FeatureUnavailable';
import LazySourceEditor from './LazySourceEditor';
import type { SourceEditorProps } from './SourceEditor';
import { useSourceEditorTools } from './SourceEditorTools';

export default function SourceEditorPane(props: SourceEditorProps) {
  const [formatted, setFormatted] = useState(false);
  const [preview, setPreview] = useState<{ source: string; text: string } | null>(null);
  const [error, setError] = useState(false);
  const { formatter, formatterUnavailable } = useSourceEditorTools();
  // The formatter became unavailable (an offline file that could not load it): back to the source.
  useEffect(() => { if (formatterUnavailable) setFormatted(false); }, [formatterUnavailable]);

  useEffect(() => {
    if (!formatted) return;
    let cancelled = false;
    setError(false);
    void formatter()
      .then(({ formatJsxPreview }) => formatJsxPreview(props.value))
      .then(text => { if (!cancelled) setPreview({ source: props.value, text }); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [formatted, props.value, formatter]);

  return <div className="flex h-full flex-col" style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4' }}>
    <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 text-xs" style={{ borderBottom: '1px solid #333' }}>
      <span>{formatted ? 'Formatted preview · read-only' : 'JSX source'}</span>
      <FeatureGate reason={formatted ? null : formatterUnavailable}>
        {(unavailable) => (
          <button type="button" aria-label={formatted ? 'Edit source' : 'View formatted'}
            className="cursor-pointer rounded border border-current px-2 py-1 disabled:cursor-default disabled:opacity-50"
            disabled={unavailable.disabled} aria-describedby={unavailable['aria-describedby']}
            onClick={() => setFormatted(value => !value)}>
            {formatted ? 'Edit source' : 'View formatted'}
          </button>
        )}
      </FeatureGate>
    </div>
    {/* Keep the editable model mounted to preserve its draft, selection and
        undo history. The preview owns a separate, strictly read-only model. */}
    <div className={`min-h-0 flex-1 ${formatted ? 'hidden' : ''}`}>
      <LazySourceEditor {...props} />
    </div>
    {formatted && <div className="min-h-0 flex-1">
      {error ? <p role="alert" className="p-3 text-sm">Couldn’t format this draft. Check the JSX syntax in Edit source and try again.</p>
        : preview?.source === props.value
          ? <LazySourceEditor value={preview.text} revision={props.revision} onChange={() => {}}
              readOnly ariaLabel="Formatted JSX" />
          : <p role="status" className="p-3 text-sm">Formatting preview…</p>}
    </div>}
  </div>;
}
