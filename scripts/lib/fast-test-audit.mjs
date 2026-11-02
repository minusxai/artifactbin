import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { auditFastSource, classifyFastGraph } from './fast-test-policy.mjs';

/** Audit the union of all enrolled graphs. Shared inputs need parsing only once;
 * every entry still resolves independently and every external edge is checked. */
export async function auditFastTests(entryPoints) {
  const result = await build({entryPoints, outdir:'.fast-audit-unused', bundle:true, write:false, metafile:true, platform:'node', format:'esm', external:['vitest','typescript'], logLevel:'silent'});
  if (result.warnings.length) throw new Error(`Unresolved fast graph: ${result.warnings.map(warning => warning.text).join(', ')}`);
  const inputs = Object.keys(result.metafile.inputs);
  const sourceReasons = inputs.flatMap(input => auditFastSource(readFileSync(input,'utf8'),input));
  if (sourceReasons.length) throw new Error(sourceReasons.join(', '));
  const classification = classifyFastGraph(result.metafile);
  if (!classification.eligible) throw new Error(`Fast test acquired service capabilities: ${classification.reasons.join(', ')}`);
  return inputs;
}
