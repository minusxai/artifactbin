import { describe, expect, it } from 'vitest';
import { scriptExportLocation } from '@/lib/document/script-export-location';

const doc = [
  '<Helmet>',
  '  <title>Sales</title>',
  '  <script>{`',
  "    import { query } from 'page';",
  "    const monthly = query('$monthly');",
  '',
  '    export function Sparkline(props) {',
  '      return <svg />;',
  '    }',
  '    export const Detail = (props) => <p>{props.item}</p>;',
  '    function Bars() { return null; }',
  '    export { Bars };',
  '  `}</script>',
  '</Helmet>',
  '<p>export function Sparkline is prose here, not the script.</p>',
  '<Sparkline rows={$monthly}><p>Loading…</p></Sparkline>',
].join('\n');

describe('where a mounted component is defined in the Helmet script', () => {
  it('finds an exported function at its export line, as a document offset and a 1-based line', () => {
    const at = scriptExportLocation(doc, 'Sparkline');
    expect(at).not.toBeNull();
    expect(at!.line).toBe(7);
    expect(doc.slice(at!.offset)).toMatch(/^export function Sparkline\(/);
  });
  it('finds an exported const and a name exported by a list', () => {
    expect(scriptExportLocation(doc, 'Detail')!.line).toBe(10);
    expect(scriptExportLocation(doc, 'Bars')!.line).toBe(12);
  });
  it('is null for a name the script does not export, or a document without a script', () => {
    expect(scriptExportLocation(doc, 'Spark')).toBeNull();
    expect(scriptExportLocation(doc, 'Missing')).toBeNull();
    expect(scriptExportLocation('<p>no script</p>', 'Sparkline')).toBeNull();
    expect(scriptExportLocation('<p>unclosed', 'Sparkline')).toBeNull();
  });
});
