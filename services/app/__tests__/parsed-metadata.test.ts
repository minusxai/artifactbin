import { expect, it } from 'vitest';
import { COMPILED_DATAFLOW, finalizeArtifactMetadata, readCompiledDataflow, storedCompiledDataflow } from '@/lib/story/parsed-artifact-metadata';
import { compiledSource } from '@/test/helpers/compiled';

const source='<Helmet><Value name="ui" type="table" value={[{view:"table",open:false}]} /><Value name="choice" type="number" default={1}/><Query name="a">{`select * from ui`}</Query><Mutation name="change" reset="choice">{`update ui set open=true`}</Mutation></Helmet><p>Hello</p>';
const refuse=async()=>{throw new Error('recompiled');};
const stored=async()=>{
  const compiled=await compiledSource(source);
  return {compiled,meta:finalizeArtifactMetadata('markup',source,{[COMPILED_DATAFLOW]:compiled} as Record<string,unknown>)};
};

it('rejects malformed nested JSONB declarations, columns, spans and graph edges, and recompiles instead',async()=>{
  const {compiled,meta}=await stored();
  const record=(meta as {parsedArtifact:{compiled:typeof compiled}}).parsedArtifact;
  const c=record.compiled;
  const bad=[
    {...c,values:[{...c.values[0],rows:[{open:{nested:true}}]}]},
    {...c,values:[{...c.values[0],columns:[{name:'open',type:'secret'}]}]},
    {...c,queries:[{...c.queries[0],start:-1}]},
    {...c,queries:[{...c.queries[0],end:source.length+1}]},
    {...c,queries:[{...c.queries[0],params:[1]}]},
    {...c,mutations:[{...c.mutations[0],scope:'server'}]},
    {...c,queries:[{...c.queries[0],reads:{...c.queries[0]!.reads,edges:['missing']}}]},
    {...c,mutationAccess:{change:true}},
  ];
  for(const b of bad){
    const parsedArtifact={...record,compiled:b};
    expect(storedCompiledDataflow({parsedArtifact},source)).toBeNull();
    expect(await readCompiledDataflow({parsedArtifact},source,async()=>null)).toEqual(compiled);
  }
  // Another source, or another compiler revision, is stale.
  expect(storedCompiledDataflow(meta,`${source} `)).toBeNull();
  expect(storedCompiledDataflow({parsedArtifact:{...record,compilerRevision:'duckdb-1'}},source)).toBeNull();
});

it('persists inline rows and reset, and round trips valid metadata without recompiling',async()=>{
  const {compiled,meta}=await stored();
  expect(compiled.values[0]).toMatchObject({kind:'table',rows:[{view:'table',open:false}]});
  expect(compiled.queries[0]!.reads).toEqual({imports:[],queries:[],values:['ui'],builtins:[]});
  expect(compiled.mutations[0]).toMatchObject({target:{local:'ui'},reset:['choice']});
  const roundTrip=JSON.parse(JSON.stringify(meta));
  expect(storedCompiledDataflow(roundTrip,source)).toEqual(compiled);
  expect(await readCompiledDataflow(roundTrip,source,refuse)).toEqual(compiled);
});

it('only the door can hand the commit a record: a JSON parsedArtifact on a new source is dropped',async()=>{
  const {meta}=await stored();
  const other=source.replace('choice','pick');
  expect(finalizeArtifactMetadata('markup',other,JSON.parse(JSON.stringify(meta)))).not.toHaveProperty('parsedArtifact');
  expect(finalizeArtifactMetadata('dataset',null,{[COMPILED_DATAFLOW]:{}} as Record<string,unknown>)).toEqual({});
});
