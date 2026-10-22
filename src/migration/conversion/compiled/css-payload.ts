/** Preserve CSS strings while preventing an HTML raw-text end tag. CSS accepts
 * an escaped slash in strings; comments and otherwise-invalid syntax stay inert. */
export function compiledStylesheetMarkup(css:string):string {
 return '<style>'+css.replace(/<\/style/gi,match=>'<\\/'+match.slice(2))+'</style>';
}
