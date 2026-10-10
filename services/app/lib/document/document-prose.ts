/** Isomorphic admission for inert text operations. Non-prose (SQL, CSS, row
 * expressions, scripts, references) remains with the complete JSX publisher.
 * Certification is installed only after publication, never by a read migration.
 */
export const PROSE_HTML_PARENTS=new Set(['section','article','div','p','span','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','blockquote','header','footer','main','aside','a','b','i','u','s']);
export interface ProseOperation {path:string[];oldText:string;newText:string}
const scanner=/\b(?:class(?:Name)?|data-design|style)\s*=|<\/?style\b|\{\s*\$_row\.|\/people\//i;
export const inertProse=(value:unknown):value is string=>typeof value==='string'&&!value.includes('\0')&&!value.includes('\r')&&value.isWellFormed()&&!scanner.test(value);
