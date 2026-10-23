import ts from 'typescript';
/** @typedef {import('./fast-test-contracts').FastTestGraph} FastTestGraph */
const SAFE_EXTERNALS = new Set(['vitest', 'typescript', 'node:crypto', 'node:path', 'node:url', 'node:util', 'node:assert', 'node:assert/strict', 'node:buffer']);
/** @returns {import('./fast-test-contracts').FastTestClassification}
 * Fail closed: every external edge must have a reviewed, non-service capability. @param {FastTestGraph} graph */
export function classifyFastGraph(graph) {
  const reasons = [];
  for (const [file, input] of Object.entries(graph.inputs)) {
    for (const edge of input.imports) {
      if (edge.external && !SAFE_EXTERNALS.has(edge.path)) reasons.push(`${file}: ${edge.path}`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
/** Enrollment only narrows the fast lane; the full inventory is never subtracted. */
export function partitionFastTests(full, enrolled) {
  if (new Set(enrolled).size !== enrolled.length) throw new Error('duplicate fast test enrollment');
  for (const file of enrolled) if (!full.includes(file)) throw new Error(`missing enrolled test: ${file}`);
  return { fast: [...enrolled], full: [...full] };
}

/** Reject ambient service/process capabilities and unresolved runtime module loads. */
export function auditFastSource(source, file) {
  const reasons = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const forbidden = new Set(['fetch', 'WebSocket', 'Worker', 'SharedWorker', 'setTimeout', 'setInterval', 'eval', 'Function']);
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
      if (forbidden.has(name)) reasons.push(`${file}: ambient ${name}`);
      if ((expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require') && (!node.arguments?.[0] || !ts.isStringLiteral(node.arguments[0]))) reasons.push(`${file}: computed module load`);
      if (ts.isElementAccessExpression(expression)) reasons.push(`${file}: computed callable capability`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return reasons;
}

/** Every test file must have an owner: a full Vitest project or the CLI's native test glob. */
export function assertFullTestCoverage(discovered, full) {
  const owners = new Set(full);
  const missing = discovered.filter(file => !owners.has(file) && !/^services\/cli\/test\/[^/]+\.test\.ts$/.test(file));
  if (missing.length) throw new Error(`tests missing from full lane: ${missing.join(', ')}`);
}
