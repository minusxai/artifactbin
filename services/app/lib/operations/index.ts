/** The operations module's interface: what code outside lib/operations imports (rule 4, scripts/ci/module-graph.mjs). */
export { runOperation } from './http';
export { forkOwner } from './registry';
export { authoredHtml } from './authored-html';
