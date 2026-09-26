/** A composition root's extensions module, as the worker threads import it (contract.test.ts). */
import type { SqlExtensions } from '../../src/extensions';

const extensions: SqlExtensions = {
  setupMutation: (database) => { database.extensionFunction('fixture_value', () => 'fixture', 0); },
};
export default extensions;
