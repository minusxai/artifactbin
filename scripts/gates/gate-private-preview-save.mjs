/** Actual HTTP archive + private preview + file:// Save proof. Run only in the
 * orchestrator's normal container gate; never a host browser/profile.
 * The delegated direct-library fixture uses startMailSink through connectAgent
 * to publish its hosted example with a genuinely verified email account. */
import assert from 'node:assert/strict';
import {register} from 'tsx/esm/api';
assert.ok(process.argv[2],'A normal gate server BASE is required');
const unregister=register();
try{await import('../fixtures/local-preview.mjs');}finally{await unregister();}
