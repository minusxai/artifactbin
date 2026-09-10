import { format } from 'prettier/standalone';
import babel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';

/** Display only. Never send this text into the edit/save pipeline: the JSX
 * interpreter preserves text whitespace differently from a JavaScript compiler. */
export async function formatJsxPreview(source: string): Promise<string> {
  if (!source.trim()) return source;
  // Documents allow multiple roots; the temporary fragment lets Babel parse
  // them together without treating a component name as executable JavaScript.
  const formatted = await format(`<>${source}</>`, {
    parser: 'babel', plugins: [babel, estree], printWidth: 100,
    tabWidth: 2, semi: true, embeddedLanguageFormatting: 'off',
  });
  // Keep the printer's indentation: blindly dedenting would also change the
  // contents of multiline SQL, CSS and script template literals in the preview.
  return formatted.slice(formatted.indexOf('<>') + 2, formatted.lastIndexOf('</>'))
    .replace(/^\n/, '').replace(/\n$/, '');
}
