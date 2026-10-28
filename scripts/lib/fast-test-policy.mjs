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
  const normalizedFile = file.replaceAll('\\', '/');
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
      // The pure query watch owns no network transport. This callback comes
      // exclusively from QueryWatchOptions.remote; audit its callers' graph too.
      const requestReceiver = ts.isPropertyAccessExpression(expression)
        ? (ts.isNonNullExpression(expression.expression) ? expression.expression.expression : expression.expression)
        : undefined;
      const injectedQueryRequest = ts.isCallExpression(node)
        && normalizedFile === 'services/app/lib/html-runtime/apollo/watch-query.ts'
        && name === 'fetch' && node.arguments.length === 0
        && requestReceiver && ts.isPropertyAccessExpression(requestReceiver)
        && ts.isIdentifier(requestReceiver.expression) && requestReceiver.expression.text === 'options'
        && requestReceiver.name.text === 'remote';
      // CSSTree's Function is a CSS grammar production, not JavaScript's
      // executable constructor. Keep this to its reviewed parser receivers.
      const cssGrammarFunction = ts.isCallExpression(node)
        && /(?:^|\/)node_modules\/css-tree\/lib\/syntax\/(?:node\/(?:Feature|FeatureRange|Ratio)|scope\/default|atrule\/import)\.js$/.test(normalizedFile)
        && ts.isPropertyAccessExpression(expression)
        && expression.expression.kind === ts.SyntaxKind.ThisKeyword
        && name === 'Function';
      if (forbidden.has(name) && !injectedPresenceClock && !injectedQueryRequest && !cssGrammarFunction) reasons.push(`${file}: ambient ${name}`);
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
      // The parser selects one grammar production; the walker selects one
      // generated AST-node iterator. Neither dispatcher owns service ports.
      const cssParserDispatch = ts.isCallExpression(node)
        && /(?:^|\/)node_modules\/css-tree\/lib\/parser\/create\.js$/.test(normalizedFile)
        && ts.isElementAccessExpression(expression)
        && expression.expression.kind === ts.SyntaxKind.ThisKeyword
        && ts.isIdentifier(expression.argumentExpression) && expression.argumentExpression.text === 'name'
        && node.arguments.length === 0;
      const cssWalkerDispatch = ts.isCallExpression(node)
        && /(?:^|\/)node_modules\/css-tree\/lib\/walker\/create\.js$/.test(normalizedFile)
        && ts.isElementAccessExpression(expression)
        && ts.isIdentifier(expression.expression) && expression.expression.text === 'iterators'
        && ts.isPropertyAccessExpression(expression.argumentExpression)
        && ts.isIdentifier(expression.argumentExpression.expression) && expression.argumentExpression.expression.text === 'node'
        && expression.argumentExpression.name.text === 'type'
        && node.arguments.length === 4
        && node.arguments.every((argument, index) => ts.isIdentifier(argument) && argument.text === ['node', 'context', 'walkNode', 'walkReducer'][index]);
      // Acorn's sole computed callback applies caller-supplied parser plugins to
      // a parser class. Only this exact Parser.extend site is admitted; callers
      // remain transitively audited, and our runtime URL analyzer uses no plugins.
      let owner = node.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      const assignment = owner?.parent;
      const acornPluginDispatch = ts.isCallExpression(node)
        && /(?:^|\/)node_modules\/acorn\/dist\/acorn\.mjs$/.test(normalizedFile)
        && owner && ts.isFunctionExpression(owner)
        && assignment && ts.isBinaryExpression(assignment)
        && assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(assignment.left)
        && ts.isIdentifier(assignment.left.expression) && assignment.left.expression.text === 'Parser'
        && assignment.left.name.text === 'extend'
        && ts.isElementAccessExpression(expression)
        && ts.isIdentifier(expression.expression) && expression.expression.text === 'plugins'
        && ts.isIdentifier(expression.argumentExpression) && expression.argumentExpression.text === 'i'
        && node.arguments.length === 1
        && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === 'cls';
      if (ts.isElementAccessExpression(expression) && !graphqlFieldDispatch && !graphqlIteratorDispatch && !cssParserDispatch && !cssWalkerDispatch && !acornPluginDispatch) reasons.push(`${file}: computed callable capability`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return reasons;
}

/** Every test file must have an owner: a full Vitest project. */
export function assertFullTestCoverage(discovered, full) {
  const owners = new Set(full);
  const missing = discovered.filter(file => !owners.has(file));
  if (missing.length) throw new Error(`tests missing from full lane: ${missing.join(', ')}`);
}
