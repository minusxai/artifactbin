import { expect, it } from 'vitest';
import { compileParsedArtifactMetadata, readParsedArtifactMetadata } from '@/lib/story/parsed-artifact-metadata';

const source='<Helmet><Value name="ui" type="table" value={[{view:"table",open:false}]} /><Value name="choice" type="number" default={1}/><Query name="a">{`select * from ui`}</Query><Mutation name="change">{`update ui set open=true`}</Mutation></Helmet><p>Hello</p>';
it('rejects malformed nested JSONB declarations, columns, spans and graph edges',()=>{
  const expected=compileParsedArtifactMetadata(source);
  const bad = [
    {...expected,flow:{...expected.flow,values:[{...expected.flow.values[0],rows:[{open:()=>true}]}]}},
    {...expected,flow:{...expected.flow,values:[{...expected.flow.values[0],columns:[{name:'open',type:'secret'}]}]}},
    {...expected,flow:{...expected.flow,queries:[{...expected.flow.queries[0],start:-1}]}},
    {...expected,flow:{...expected.flow,queries:[{...expected.flow.queries[0],end:source.length+1}]}},
    {...expected,flow:{...expected.flow,queries:[{...expected.flow.queries[0],params:[1]}]}},
    {...expected,flow:{...expected.flow,mutations:[{...expected.flow.mutations![0],scope:'server'}]}},
    {...expected,queryDependencies:{a:['missing']}},
    {...expected,flow:{...expected.flow,mutationAccess:{change:true}}},
  ];
  for(const parsedArtifact of bad)expect(readParsedArtifactMetadata({parsedArtifact},source)).toEqual(expected);
});
it('persists inline rows only and round trips valid metadata',()=>{
  const compiled=compileParsedArtifactMetadata(source);
  expect(compiled.flow.values[0]).toMatchObject({kind:'table',rows:[{view:'table',open:false}]});
  expect(compiled.queryDependencies).toEqual({a:['ui']});
  expect(readParsedArtifactMetadata({parsedArtifact:JSON.parse(JSON.stringify(compiled))},source)).toEqual(compiled);
});
