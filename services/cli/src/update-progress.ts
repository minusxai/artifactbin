import type {UpdateProgress} from './update';
import {createStyle,type Style} from './style';
/**
 * The terminal view of a foreground `afbin update`. Callers draw it only on a live stderr and never
 * with --json: it rewrites one line in place, which a pipe or an agent's transcript cannot use.
 */
export function progressRenderer(write:(text:string)=>void,style:Style=createStyle({color:false})):(event:UpdateProgress)=>void{
 return event=>{
  switch(event.stage){
   case 'release':
    write(event.current===event.available?`afbin ${style.bold(event.available)} is already current; checking skills.\n`:`Updating afbin ${event.current} → ${style.bold(event.available)}\n`);
    return;
   case 'install':write(event.recovered?`Resuming the interrupted update to afbin ${event.version}…\n`:`Installing afbin ${event.version}…\n`);return;
  }
 };
}
