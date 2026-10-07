import {baseUrl} from '../http/http';

/** Launch guidance only: User-Agent is not an authentication or authorization boundary. */
export function cliNpmRequired(request:Request):Response|null {
 const version=/^afbin\/(\d+)\.(\d+)\.(\d+)$/.exec(request.headers.get('User-Agent')??'');
 if(!version||BigInt(version[1]!)!==0n||BigInt(version[2]!)>=4n)return null;
 const origin=baseUrl(request);
 // The old CLI prints message, then hint: together they read as one instruction, npx line first.
 return Response.json({error:'cli_npm_required',message:'afbin now installs through npm. Run once: npx --yes @afbin/cli@latest setup — then use afbin as before.',hint:`Windows PowerShell: npx.cmd --yes @afbin/cli@latest setup. If Node.js 22+ is missing, run ${origin}/chat/install-node.sh (macOS/Linux) or ${origin}/chat/install-node.ps1 (Windows) first. Your files, account and skills stay.`},{status:426});
}
