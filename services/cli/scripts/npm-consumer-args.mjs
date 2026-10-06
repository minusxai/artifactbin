import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
/** Native consumers share one tested tarball. Windows also has a separate standard-user standalone npx proof. */
export function npmConsumerArgs(tarball,platform){
 return ['exec','--yes',...(platform==='win32'?[]:['--package',tarball]),'--','afbin','query','rows.csv','--json'];
}

/** Seeded CI installs resolve the locked closure from verified blobs; lifecycle scripts still run. */
export function npmConsumerInstallArgs(tarball,seeded){
 return ['install',...(seeded?['--offline']:[]),'--foreground-scripts','--timing','--no-audit','--no-fund',tarball];
}

/** Emit only fixed phase names and durations, never npm's metadata, paths or URLs. */
export async function npmInstallPhaseTimings(directory){
 let files;try{files=await readdir(directory);}catch(error){if(error.code==='ENOENT')return {};throw error;}
 const phases=['npm','command:install','idealTree','reify','reify:loadTrees','reify:diffTrees','reify:retireShallow','reify:createSparse','reify:unpack','reify:build','reify:audit','build','build:deps','build:run:install','build:run:postinstall','reify:save'];
 const result={};
 for(const file of files.filter(file=>file.endsWith('-timing.json'))){
  const {timers={}}=JSON.parse(await readFile(join(directory,file),'utf8'));
  for(const phase of phases)if(Number.isFinite(timers[phase])&&timers[phase]>=0)result[phase]=timers[phase];
 }
 return result;
}
