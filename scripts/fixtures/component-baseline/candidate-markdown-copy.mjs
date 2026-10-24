/** The historical Markdown component has no copy control; these are explicitly
 * candidate-only enhancement checks, never paired source-baseline states. */
export const candidateMarkdownCopyCases=Object.freeze([
 {id:'markdown-copy-success',baselineCompatibility:'candidate-only enhancement',clipboard:'real',expectedStatus:'Copied'},
 {id:'markdown-copy-rejected',baselineCompatibility:'candidate-only enhancement',clipboard:'rejected',expectedStatus:'Copy unavailable'},
]);
