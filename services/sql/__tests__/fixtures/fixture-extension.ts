/**
 * A composition root's extensions module, as the worker threads and the app's
 * own analysis import it (contract.test.ts, services/app sql-extensions.test.ts).
 * `fixture_generate` is the generation pattern: a mutation-only function whose
 * real run aborts the statement to demand an external result (the continuation),
 * and whose dry run is a NULL stub.
 */
import type { QueryFailure } from '@artifactbin/contracts';
import type { SqlExtensions } from '../../src/extensions';

const extensions: SqlExtensions = {
  setupMutation: (database, { dryRun }) => {
    database.extensionFunction('fixture_value', () => 'fixture', 0);
    // Per write: a demand never leaks into the next statement this thread runs.
    let demand: QueryFailure['continuation'];
    database.extensionFunction('fixture_generate', (text) => {
      if (dryRun) return null;
      demand = { kind: 'fixture_generate', payload: { text } };
      throw new Error('Model result required');
    }, 1);
    return () => demand;
  },
};
export default extensions;
