import {baseUrl} from '../http/http';

/** Launch guidance only: User-Agent is not an authentication or authorization boundary. */
export function cliNpmRequired(request:Request):Response|null {
 const version=/^afbin\/(\d+)\.(\d+)\.(\d+)$/.exec(request.headers.get('User-Agent')??'');
 if(!version||BigInt(version[1]!)!==0n||BigInt(version[2]!)>=4n)return null;
 const origin=baseUrl(request);
 return Response.json({error:'cli_npm_required',message:'afbin now runs through npm. Install Node.js if needed, then use npx --yes @afbin/cli@latest <command>.',hint:`Node/npm setup: ${origin}/chat/ensure-node.sh (macOS/Linux), ${origin}/chat/ensure-node.ps1 (Windows). Then run npx --yes @afbin/cli@latest <command>. In Windows PowerShell use npx.cmd --yes @afbin/cli@latest <command>. Your files and account stay the same.`},{status:426});
}
