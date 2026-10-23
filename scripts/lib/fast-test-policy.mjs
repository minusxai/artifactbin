import ts from 'typescript';
/** @typedef {import('./fast-test-contracts').FastTestGraph} FastTestGraph */
const SAFE_EXTERNALS = new Set(['vitest', 'typescript', 'node:crypto', 'node:path', 'node:url', 'node:util', 'node:assert', 'node:assert/strict', 'node:buffer']);
/** @returns {import('./fast-test-contracts').FastTestClassification}
 * Fail closed: every external edge must have a reviewed, non-service capability. @param {FastTestGraph} graph */
export function classifyFastGraph(graph) {
  const reasons = [];
  for (const [file, input] of Object.entries(graph.inputs)) {
    if (/\.ui\.test\.[cm]?[jt]sx?$/.test(file)) reasons.push(`${file}: DOM project requires a browser environment`);
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
  const forbidden = new Set(['fetch', 'WebSocket', 'Worker', 'SharedWorker', 'setTimeout', 'setInterval', 'eval', 'Function', 'importActual', 'importMock']);
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
      // These two pure models receive all scheduling through their explicit
      // ReaderPresencePorts/PresenceRoomPorts contract. Their transitive test
      // graph is still audited; ambient timers and every other receiver fail.
      const injectedPresenceClock = ts.isCallExpression(node)
        && ['services/app/lib/html-presence/reader-session.ts', 'services/app/lib/html-presence/room.ts'].includes(file.replaceAll('\\', '/'))
        && ['setTimeout', 'setInterval'].includes(name)
        && ts.isPropertyAccessExpression(expression)
        && ts.isPropertyAccessExpression(expression.expression)
        && ts.isIdentifier(expression.expression.expression)
        && expression.expression.expression.text === 'ports'
        && expression.expression.name.text === 'clock';
      if (forbidden.has(name) && !injectedPresenceClock) reasons.push(`${file}: ambient ${name}`);
      if ((expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require') && (!node.arguments?.[0] || !ts.isStringLiteral(node.arguments[0]))) reasons.push(`${file}: computed module load`);
      // graphql-js's default field resolver calls a field supplied by the caller.
      // Keep the exception to this exact reviewed dispatcher, not arbitrary package calls.
      const graphqlFieldDispatch = /(?:^|\/)node_modules\/graphql\/execution\/execute\.(?:m?js)$/.test(file.replaceAll('\\', '/'))
        && ts.isElementAccessExpression(expression)
        && ts.isIdentifier(expression.expression) && expression.expression.text === 'source'
        && ts.isPropertyAccessExpression(expression.argumentExpression)
        && ts.isIdentifier(expression.argumentExpression.expression) && expression.argumentExpression.expression.text === 'info'
        && expression.argumentExpression.name.text === 'fieldName';
      const graphqlIteratorDispatch = /(?:^|\/)node_modules\/graphql\/execution\/mapAsyncIterator\.(?:m?js)$/.test(file.replaceAll('\\', '/'))
        && ts.isElementAccessExpression(expression)
        && ts.isIdentifier(expression.expression) && expression.expression.text === 'iterable'
        && ts.isPropertyAccessExpression(expression.argumentExpression)
        && ts.isIdentifier(expression.argumentExpression.expression) && expression.argumentExpression.expression.text === 'Symbol'
        && expression.argumentExpression.name.text === 'asyncIterator';
      if (ts.isElementAccessExpression(expression) && !graphqlFieldDispatch && !graphqlIteratorDispatch) reasons.push(`${file}: computed callable capability`);
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
