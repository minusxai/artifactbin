import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {archiveDirectory} from '../../services/cli/scripts/runtime-archive.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
it('packs executable files and relative links with exact checksums in deterministic order',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-archive-'));
 try{
  const source=join(root,'source');await mkdir(source);await mkdir(join(source,'bin'));
  await writeFile(join(source,'bin','browser'),'executable',{mode:0o755});await symlink('bin/browser',join(source,'current'));
  const out=join(root,'package.gz');const spec=await archiveDirectory(source,{prefix:'node_modules/browser',out,url:'https://example.com/browser.gz'});
  expect(spec.files.map(file=>file.path)).toEqual(['node_modules/browser/bin/browser','node_modules/browser/current']);
  expect(spec.files[0].mode).toBe(0o700);expect(spec.files[1].link).toBe('bin/browser');
  const compressed=await readFile(out);expect(spec.sha256).toBe(hash(compressed));
  const bytes=gunzipSync(compressed);let offset=0;
  for(const file of spec.files){expect(file.sha256).toBe(hash(bytes.subarray(offset,offset+file.size)));offset+=file.size;}
  expect(offset).toBe(bytes.length);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('reuses a matching compressed archive and repairs changed inputs or corrupt cache bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-archive-cache-'));
 try{
  const source=join(root,'source'),cache=join(root,'cache'),out=join(root,'out.gz');await mkdir(source);await writeFile(join(source,'file'),'original');
  const options={prefix:'node_modules/browser',out,url:'https://example.com/one.gz',cache};
  await archiveDirectory(source,options);
  const cached=join(cache,'archive.gz'),metadata=join(cache,'archive.json');
  const alternate=gzipSync(Buffer.from('original'),{level:1});
  const record=JSON.parse(await readFile(metadata,'utf8'));record.sha256=hash(alternate);
  await writeFile(cached,alternate);await writeFile(metadata,JSON.stringify(record));
  const reused=await archiveDirectory(source,{...options,url:'https://example.com/two.gz'});
  expect(await readFile(out)).toEqual(alternate);expect(reused.url).toContain('two.gz');
  await writeFile(cached,'corrupt');await archiveDirectory(source,options);
  expect(gunzipSync(await readFile(out)).toString()).toBe('original');
  await writeFile(join(source,'file'),'edited');await archiveDirectory(source,options);
  expect(gunzipSync(await readFile(out)).toString()).toBe('edited');
 }finally{await rm(root,{recursive:true,force:true});}
});
