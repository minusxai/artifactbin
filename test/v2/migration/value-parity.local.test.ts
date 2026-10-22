import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "Value manifests match the pinned archived parser for defaults, temporal inference and schema order",
  { skip: !root },
  () => {
    const script = `
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readLocalSourceManifest} from ${JSON.stringify(new URL("../../../src/migration/conversion/compiled/source-manifest.ts", import.meta.url).href)};
import {validLocalValue,normalizeLocalTimestamp} from ${JSON.stringify(new URL("../../../src/migration/conversion/compiled/local-state.ts", import.meta.url).href)};
const root=${JSON.stringify(root)};
const {parseJsx}=await import(pathToFileURL(root+'/services/app/lib/jsx/parse.ts').href);
const {parseValueDecl,scalarMatches}=await import(pathToFileURL(root+'/services/app/lib/dataflow/dataflow.ts').href);
const {normalizeTimestamp}=await import(pathToFileURL(root+'/services/utils/src/shape.ts').href);
const fixtures=[
 '<Value name="search" default="001"/>',
 '<Value name="day" type="date" default="2026-02-31"/>',
 '<Value name="owner" type="user"/>',
 '<Value name="owner" type="user" default="001"/>',
 '<Value name="instant" type="timestamp" default="2026-01-02 03:04:05.123456789+0530"/>',
 '<Value name="instant" type="timestamp" default={1700000000000}/>',
 '<Value name="rows" type="table" value={[{period:"2026-01",day:"2026-01-02",instant:"2026-01-02T03:04+05",empty:null}]}/>',
 '<Value name="rows" type="table" value={[{n:2,day:"2026-01-02"}]} columns={[{name:"day",type:"date"}]}/>',
 '<Value name="rows" type="table" value={[]} columns={[{name:"instant",type:"timestamp"},{name:"owner",type:"user"}]}/>',
];
for(const source of fixtures){const tree=parseJsx(source);assert.equal(tree.ok,true);const result=parseValueDecl(tree.nodes[0]);assert.equal(result.ok,true);const d=result.decl;const expected=d.kind==='table'?{name:d.name,type:'table',default:d.rows,columns:d.columns}:{name:d.name,type:d.type,default:d.default};assert.deepEqual(readLocalSourceManifest(source).declarations,[expected]);}
const values=[null,'2026-01','2026-01-02','2026-02-29','2024-02-29','2026-01-02 03:04:05+0530','2026-01-02T03:04:05.123456789Z','2026-01-02T25:00Z','2026-01-02T00:00+99:00','001',2,1700000000000,Infinity,{},[]];
for(const type of ['string','number','boolean','date','timestamp','user'])for(const value of values){assert.equal(validLocalValue({name:'value',type,default:null},value),scalarMatches(value,type));if(type==='timestamp'&&value!==null&&scalarMatches(value,type))assert.equal(normalizeLocalTimestamp(value),normalizeTimestamp(value));}
process.stdout.write('parity verified');`;
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        path.join(root!, "node_modules/tsx/dist/loader.mjs"),
        "--input-type=module",
        "--eval",
        script,
      ],
      {
        encoding: "utf8",
        cwd: path.join(root!, "services/app"),
        env: {
          PATH: process.env.PATH,
          TSX_TSCONFIG_PATH: path.join(root!, "tsconfig.json"),
        },
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "parity verified");
  },
);
