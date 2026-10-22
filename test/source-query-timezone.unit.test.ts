import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const timezone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
  test(`source timestamps preserve legacy UTC instants across process timezone ${timezone}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
import {createRequire} from 'node:module';
const Result=createRequire(import.meta.url)('pg/lib/result');
import {createSourceQueryResources} from './src/datasets/source-query/resources.ts';
import {normalizeSourceTimestamp} from './src/datasets/source-query/timestamps.ts';
if(normalizeSourceTimestamp('2026-10-15T00:00:00',1114)!=='2026-10-15T00:00:00.000Z'||normalizeSourceTimestamp('2026-10-15T00:00:00+05:30',1184)!=='2026-10-14T18:30:00.000Z')throw Error('JSON timestamp timezone regression');
let parsers;
const resources=createSourceQueryResources(JSON.stringify({resources:{'source-ABC123':{connectionStringEnv:'PAGEGI_SOURCE_QUERY_TEST_URL',caEnv:'PAGEGI_SOURCE_QUERY_TEST_CA'}}}),{PAGEGI_SOURCE_QUERY_TEST_URL:'postgres://reader:secret@db.invalid/source',PAGEGI_SOURCE_QUERY_TEST_CA:'ca'},options=>{parsers=options.types;return{connect:async()=>{throw Error('unused')},end:async()=>{},on(){}}});
const parse=(oid,value)=>{const result=new Result(undefined,parsers);result.addFields([{name:'value',dataTypeID:oid,format:'text'}]);return result.parseRow([value]).value;};
const results=[
 parse(1114,'2026-10-15 00:00:00'),
 parse(1114,'2026-03-08 02:30:00.123456'),
 parse(1184,'2026-10-15 00:00:00+05:30'),
 parse(1184,'2026-10-15 00:00:00-04'),
 parse(1184,'2026-10-15 00:00:00+00'),
 parse(1082,'2026-10-15'),
 ...[1082,1114,1184].map(oid=>parse(oid,null)),
 ...[1114,1184].flatMap(oid=>['infinity','-infinity','invalid'].map(value=>parse(oid,value))),
 parse(1082,'infinity'),parse(1082,'invalid')
];
console.log(JSON.stringify(results));await resources.close();
`,
      ],
      { encoding: "utf8", env: { ...process.env, TZ: timezone } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      "2026-10-15T00:00:00.000Z",
      "2026-03-08T02:30:00.123Z",
      "2026-10-14T18:30:00.000Z",
      "2026-10-15T04:00:00.000Z",
      "2026-10-15T00:00:00.000Z",
      "2026-10-15",
      null,
      null,
      null,
      "infinity",
      "-infinity",
      "invalid",
      null,
      null,
      null,
      "infinity",
      "invalid",
    ]);
  });
}
