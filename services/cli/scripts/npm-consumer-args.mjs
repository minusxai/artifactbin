import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
/** Unix Node22 lanes prove standalone npx; Windows and Node24 reuse their fresh native install. */
export function npmConsumerArgs(tarball,platform,nodeMajor=22){
 return ['exec','--yes',...(platform==='win32'||nodeMajor===24?[]:['--package',tarball]),'--','afbin','query','rows.csv','--json'];
}

/** Seeded CI installs resolve the locked closure from verified blobs; lifecycle scripts still run. */
export function npmConsumerInstallArgs(tarball,seeded){
 return ['install',...(seeded?['--offline']:[]),'--foreground-scripts','--timing','--no-audit','--no-fund',tarball];
}

/** Emit only fixed phase names and durations, never npm's metadata, paths or URLs. */
export async function npmInstallPhaseTimings(directory,{fileCount=1}={}){
 let files;try{files=await readdir(directory);}catch(error){if(error.code==='ENOENT')return {};throw error;}
 const phases=['npm','command:exec','command:install','idealTree','reify','reify:loadTrees','reify:diffTrees','reify:retireShallow','reify:createSparse','reify:unpack','reify:build','reify:audit','build','build:deps','build:run:install','build:run:postinstall','reify:save'];
 const result={};
 const count=Number.isInteger(fileCount)?Math.min(2,Math.max(1,fileCount)):1;
 for(const file of files.filter(file=>file.endsWith('-timing.json')).sort().slice(-count)){
  const {timers={}}=JSON.parse(await readFile(join(directory,file),'utf8'));
  for(const phase of phases)if(Number.isFinite(timers[phase])&&timers[phase]>=0&&timers[phase]<=86400000)result[phase]=timers[phase];
 }
 return result;
}

if(process.argv[1]&&process.argv[2]==='diagnostic-timings'&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const directory=process.argv[3];if(!directory)throw Error('Pass the private npm log directory');
 console.log(JSON.stringify(await npmInstallPhaseTimings(directory,{fileCount:2})));
}
