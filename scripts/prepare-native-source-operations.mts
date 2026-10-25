/** Private/offline receipt preparation. Usage: node --import tsx scripts/prepare-native-source-operations.mts request.json */
import {readFile} from 'node:fs/promises';
import {prepareNativeSourceOperationFiles} from '../src/migration/native-components/operation-preparation-files.ts';
if(process.argv.length!==3)throw Error('Expected one private operation preparation request JSON path');
const request=JSON.parse(await readFile(process.argv[2]!,'utf8'));
console.log(JSON.stringify(await prepareNativeSourceOperationFiles(request)));
