/** Terminal styling for human-facing output. Structured output (--json, --output, --format) never carries escapes. */
export type Depth='truecolor'|'256'|'16';
export interface StyleOptions {color:boolean;depth?:Depth}
export interface Style {
 readonly enabled:boolean;
 bold(text:string):string;dim(text:string):string;red(text:string):string;green(text:string):string;yellow(text:string):string;cyan(text:string):string;
 /** The brand accent: the first stop of the gradient. */
 accent(text:string):string;
 /** Each character coloured along the five-stop brand gradient, as the installer prints the wordmark. */
 wordmark(text:string):string;
}
const STOPS:Record<Depth,readonly string[]>={
 truecolor:['38;2;167;139;250','38;2;186;131;240','38;2;205;123;229','38;2;224;116;208','38;2;244;114;182'],
 '256':['38;5;141','38;5;140','38;5;176','38;5;212','38;5;211'],
 '16':['35','35','35','35','35'],
};
const ESC='\x1b[';
const code=(sgr:string)=>(text:string)=>text?`${ESC}${sgr}m${text}${ESC}0m`:text;
/** NO_COLOR always wins; FORCE_COLOR enables colour without a terminal; TERM=dumb and pipes stay plain. */
export function colorSupport(env:NodeJS.ProcessEnv,isTTY:boolean):StyleOptions{
 if(env.NO_COLOR)return {color:false};
 const term=env.TERM??'';
 if(!env.FORCE_COLOR&&(!isTTY||term==='dumb'))return {color:false};
 const depth:Depth=/^(truecolor|24bit)$/i.test(env.COLORTERM??'')?'truecolor':/256color|truecolor|direct/.test(term)?'256':'16';
 return {color:true,depth};
}
export function createStyle(options:StyleOptions):Style{
 if(!options.color){const same=(text:string)=>text;return {enabled:false,bold:same,dim:same,red:same,green:same,yellow:same,cyan:same,accent:same,wordmark:same};}
 const stops=STOPS[options.depth??'16'];
 return {
  enabled:true,bold:code('1'),dim:code('2'),red:code('31'),green:code('32'),yellow:code('33'),cyan:code('36'),accent:code(stops[0]),
  wordmark:text=>text?[...text].map((char,i)=>`${ESC}${stops[Math.min(stops.length-1,Math.floor(i*stops.length/text.length))]}m${char}`).join('')+`${ESC}0m`:text,
 };
}
export function stripAnsi(text:string):string{return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');}
export function visibleWidth(text:string):number{return [...stripAnsi(text)].length;}
/** Greedy word wrap on visible width; a word longer than the width stands on its own line. */
export function wrap(text:string,width:number):string[]{
 const lines:string[]=[];let line='';
 for(const word of text.split(/\s+/).filter(Boolean)){
  if(line&&visibleWidth(line)+1+visibleWidth(word)>width){lines.push(line);line=word;}
  else line=line?`${line} ${word}`:word;
 }
 if(line)lines.push(line);
 return lines;
}
/** Colour the pretty-printed JSON that commands print for people: keys, strings, numbers, literals. */
export function highlightJson(text:string,s:Style):string{
 if(!s.enabled)return text;
 return text.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,(match,quoted?:string,colon?:string,literal?:string)=>{
  if(quoted!==undefined)return colon?`${s.cyan(quoted)}${colon}`:s.green(quoted);
  if(literal!==undefined)return s.accent(literal);
  return s.yellow(match);
 });
}
/** Colour a unified diff: file headers bold, hunks cyan, additions green, removals red. */
export function highlightDiff(text:string,s:Style):string{
 if(!s.enabled)return text;
 let header=true;
 return text.split('\n').map(line=>{
  if(/^(Index: |={4})/.test(line)){header=true;return s.bold(line);}
  if(header&&/^(---|\+\+\+) /.test(line))return s.bold(line);
  if(line.startsWith('@@')){header=false;return s.cyan(line);}
  if(line.startsWith('\\ '))return s.dim(line);
  if(!header&&line.startsWith('+'))return s.green(line);
  if(!header&&line.startsWith('-'))return s.red(line);
  return line;
 }).join('\n');
}
