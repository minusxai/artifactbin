import {it,expect} from 'vitest';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {candidateManifest,startCandidateRegistry} from '../../services/cli/scripts/windows-setup-registry.mjs';

function archive(manifest){
 const body=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(512);
 header.write('package/package.json');header.write(body.length.toString(8).padStart(11,'0'),124);
 return gzipSync(Buffer.concat([header,body,Buffer.alloc(512-body.length%512),Buffer.alloc(1024)]));
}
it('serves the exact unpublished candidate with dependencies and verified npm integrity',async()=>{
 const manifest={name:'@afbin/cli',version:'0.0.0-test',bin:{afbin:'dist/afbin.mjs'},dependencies:{sharp:'1.2.3'}};
 const bytes=archive(manifest),registry=await startCandidateRegistry(bytes);
 try{
  const response=await fetch(registry.origin+'/@afbin%2fcli');expect(response.status).toBe(200);
  const metadata=await response.json(),candidate=metadata.versions[manifest.version];
  expect(candidate.dependencies).toEqual(manifest.dependencies);
  expect(metadata['dist-tags'].latest).toBe(manifest.version);
  expect(candidate.dist.integrity).toBe('sha512-'+createHash('sha512').update(bytes).digest('base64'));
  expect(Buffer.from(await (await fetch(candidate.dist.tarball)).arrayBuffer())).toEqual(bytes);
  expect((await fetch(registry.origin+'/other-package')).status).toBe(404);
 }finally{await registry.close();}
});
it('rejects archives without the expected npm manifest',()=>{
 expect(()=>candidateManifest(gzipSync(Buffer.alloc(1024)))).toThrow(/manifest/);
 expect(()=>candidateManifest(archive({name:'other',version:'1.0.0'}))).toThrow(/@afbin\/cli/);
});
