/** Bounded source syntax classification; never executes callbacks or rewrites code. */
export interface StaticMermaidSyntax {
 readonly kind: 'flowchart' | 'sequence';
 readonly literalLabelBreaks: number;
}
