import type {UpdateProgress} from './update';
import {createStyle,type Style} from './style';
/**
 * The terminal view of a foreground `afbin update`. Callers draw it only on a live stderr and never
 * with --json: it rewrites one line in place, which a pipe or an agent's transcript cannot use.
 */
const BAR=24;
const megabytes=(bytes:number)=>(bytes/1048576).toFixed(1);
export function progressRenderer(write:(text:string)=>void,style:Style=createStyle({color:false})):(event:UpdateProgress)=>void{
 // The line currently drawn in place, rewritten only when its text changes (a percentage or a tenth of
 // a megabyte), so a fast link redraws a few hundred times at most instead of once per chunk.
 let drawn:string|undefined;let total:number|undefined;
 const draw=(line:string)=>{if(line===drawn)return;drawn=line;write(`\r\x1b[2K${line}`);};
 const downloading=(received:number,size?:number)=>{
  if(!size)return `  Downloading ${megabytes(received)} MB`;
  const percent=Math.min(100,Math.floor(received*100/size)),filled=Math.round(percent*BAR/100);
  return `  Downloading ${style.accent('█'.repeat(filled))}${style.dim('░'.repeat(BAR-filled))} ${String(percent).padStart(3)}%  ${megabytes(Math.min(received,size))}/${megabytes(size)} MB`;
 };
 return event=>{
  switch(event.stage){
   case 'release':
    write(event.current===event.available?`afbin ${style.bold(event.available)} is already current; checking skills.\n`:`Updating afbin ${event.current} → ${style.bold(event.available)}\n`);
    return;
   case 'download':total=event.total;draw(downloading(event.received,total));return;
   case 'downloaded':draw(downloading(event.bytes,total));write('\n');drawn=undefined;return;
   case 'install':write(event.recovered?`Resuming the interrupted update to afbin ${event.version}…\n`:`Installing afbin ${event.version}…\n`);return;
  }
 };
}
