/**
 * Internal: publish.mjs's deprecated sample/request flags (--prepare, --send). The current command
 * is in toolbox-publish.mjs.
 * Used by: publish.mjs (main, when argv[2] is --prepare or --send).
 */
import {readFile, writeFile} from 'node:fs/promises';

/** Runs the deprecated flags with publish.mjs's prepareSample and sendPublication. */
export async function main(args, {prepareSample, sendPublication}) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: node publish.mjs --prepare SAMPLE --server ORIGIN --output REQUEST.json ' +
        '[--dataset-id ID]\n       node publish.mjs --send REQUEST.json\nSAMPLE: report, ' +
        'repairs-data, csv-dashboard, shared-app. Send requires origin-matched ARTIFACTBIN_URL ' +
        'and ARTIFACTBIN_TOKEN. Prefer publication-bundle.mjs --send to save dependency receipts.'
    );
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (
      !['--prepare', '--server', '--output', '--dataset-id', '--send'].includes(flag) ||
      !args[index + 1] ||
      Object.hasOwn(options, flag)
    )
      throw Error(
        'Use --prepare SAMPLE --server ORIGIN --output REQUEST.json, or --send REQUEST.json.'
      );
    options[flag] = args[index + 1];
  }
  if (options['--prepare']) {
    if (options['--send'] || !options['--server'] || !options['--output'])
      throw Error('Preparation requires server and output, without send.');
    const saved = await prepareSample(
      options['--prepare'],
      options['--server'],
      options['--dataset-id']
    );
    await writeFile(options['--output'], JSON.stringify(saved, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600
    });
    process.stdout.write(
      'Saved publication request. Reuse this file and its key after an uncertain result.\n'
    );
  } else if (options['--send']) {
    if (Object.keys(options).length !== 1)
      throw Error('Send uses only the saved request; do not override its origin or payload.');
    const saved = JSON.parse(await readFile(options['--send'], 'utf8'));
    const receipt = await sendPublication(saved);
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  } else throw Error('Choose prepare or send.');
}
