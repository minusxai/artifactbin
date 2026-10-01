import fs from 'node:fs';
import {createDocumentGraph,graphSource} from './lib/story/graph/document-graph';
import {prepareClientDocument} from './lib/story/graph/document-update-client';
import {stampNodeIds} from './lib/story/document/node-ids';
const raw=fs.readFileSync(process.argv[2],'utf8');
for(const mode of ['stamped','raw']){
 const src=mode==='stamped'?stampNodeIds(raw,{}).source:raw;
 const doc=createDocumentGraph(src,1);const before=graphSource(doc);
 for(let i=0;i<3;i++){const s=performance.now();prepareClientDocument({document:doc,version:1,meta:{}},{source:before.replace('where typing happens.','where typing happens. fox'+i)});console.log(mode,before.length,'ms',Math.round(performance.now()-s));}
}
