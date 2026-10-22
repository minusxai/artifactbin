import { compileNativeProgramResolver } from "./native-compiler.ts";
import type { ConversionOutput } from "../contracts.ts";
const esc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
/** Ordinary HTML/Apollo page; only the exact saved server registration can execute it. */
export async function convertNativeProgramPage(input: {
  source: string;
  coreUrl: string;
  title: string;
  binding?: { backendHref: string; backendNamespace: string };
}): Promise<ConversionOutput> {
  try {
    const nativeProgram = await compileNativeProgramResolver(input.source);
    if (input.binding && input.binding.backendNamespace !== "legacyData")
      throw Error("Native binding invalid");
    return {
      classification: input.binding ? "functional" : "renderable",
      nativeProgram,
      html: `<!doctype html><html lang="en" data-af-design-system="signout"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.title)}</title><script type="application/json" data-af="state">{"programInput":"null","programOutput":"","programStatus":"Ready to run"}</script><script data-af="core" src="${esc(input.coreUrl)}"></script>${input.binding ? `<link rel="af-backend" data-af-name="legacyData" href="${esc(input.binding.backendHref)}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;background:var(--background,#fff);color:var(--foreground,#17202a);font-family:var(--font-sans,system-ui,sans-serif);line-height:1.5}main{max-width:70rem;margin:0 auto;padding:clamp(1.25rem,5vw,4rem)}header{max-width:42rem;margin-bottom:2.5rem}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15;letter-spacing:-.035em;margin:0 0 1rem;overflow-wrap:anywhere}header p,.hint{color:var(--muted-foreground,#59636f);margin:.5rem 0}.workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border:1px solid var(--border,#d8dee4);border-radius:var(--radius,.75rem);overflow:hidden;background:var(--card,#fff)}section{min-width:0;padding:1.5rem}section+section{border-left:1px solid var(--border,#d8dee4);background:var(--muted,#f6f8fa)}h2,label{font-size:1rem;font-weight:600;margin:0}label{display:block}.hint{font-size:.875rem;min-height:2.6em}textarea,pre{font-family:var(--font-mono,ui-monospace,monospace);font-size:.9rem;line-height:1.65;tab-size:2}textarea{display:block;resize:vertical;width:100%;min-height:16rem;padding:1rem;margin:1rem 0;background:var(--background,#fff);color:var(--foreground,#17202a);border:1px solid var(--border,#d8dee4);border-radius:calc(var(--radius,.75rem)/2)}textarea[aria-invalid="true"]{border-color:var(--destructive,#b42318)}textarea:focus-visible,button:focus-visible{outline:3px solid var(--ring,#4c78dd);outline-offset:3px}button{font:inherit;font-weight:600;background:var(--primary,#244ac2);color:var(--primary-foreground,#fff);border:0;border-radius:calc(var(--radius,.75rem)/2);padding:.7rem 1.25rem;min-width:8.5rem;cursor:pointer}button:disabled{opacity:.6;cursor:default}pre{margin:1rem 0 0;white-space:pre-wrap;overflow-wrap:anywhere;min-height:16rem}#program-status{font-size:.875rem;color:var(--muted-foreground,#59636f);margin:1rem 0 0;min-height:3em}#program-status[data-error="true"]{color:var(--destructive,#b42318)}@media(max-width:42rem){.workbench{grid-template-columns:1fr}section+section{border-left:0;border-top:1px solid var(--border,#d8dee4)}section{padding:1.25rem}textarea,pre{min-height:10rem}header{margin-bottom:1.5rem}}
</style></head><body><main><header><h1>${esc(input.title)}</h1><p>Give this program JSON input and see its output. Only the owner can run it.</p></header><div class="workbench"><section><form data-af-id="program-form"><label for="program-input">JSON input</label><p class="hint" id="program-input-hint">Use an object, list, or a single value. Leave null if no input is needed.</p><textarea id="program-input" data-af-id="program-input" aria-describedby="program-input-hint program-status" spellcheck="false">null</textarea><button ${input.binding ? "" : "disabled"}>Run program</button></form><p id="program-status" data-af-id="program-status" role="status" aria-live="polite">${input.binding ? "Ready to run" : "This saved version cannot be run."}</p></section><section aria-labelledby="program-output-heading"><h2 id="program-output-heading">Output</h2><p class="hint">The latest completed run stays here while you edit or run again.</p><pre data-af-id="program-output" aria-label="Program output">No output yet.</pre></section></div></main><script type="module">
import {gql,client} from '@afbin/apollo';
const form=document.querySelector('[data-af-id="program-form"]'),input=document.querySelector('[data-af-id="program-input"]'),output=document.querySelector('[data-af-id="program-output"]'),status=document.querySelector('#program-status'),button=form.querySelector('button');
const DRAFT=gql\`{programInput}\`,OUTPUT=gql\`{programOutput}\`,STATUS=gql\`{programStatus}\`,VIEW=gql\`{programInput programOutput programStatus}\`;
const view=client.watchQuery({query:VIEW}).subscribe(({data})=>{if(input.value!==(data.programInput??'null'))input.value=data.programInput??'null';output.textContent=data.programOutput||'No output yet.';status.textContent=${input.binding ? "data.programStatus||'Ready to run'" : "'This saved version cannot be run.'"};});
input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');client.updateQuery({query:DRAFT},()=>({programInput:input.value}));});
const show=programStatus=>client.updateQuery({query:STATUS},()=>({programStatus}));
form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;let inputJson;try{inputJson=JSON.stringify(JSON.parse(input.value));}catch{input.setAttribute('aria-invalid','true');status.dataset.error='true';await show('Enter valid JSON before running. Your previous output is unchanged.');input.focus();return;}
button.disabled=true;button.textContent='Running…';form.setAttribute('aria-busy','true');status.dataset.error='false';await show('Running…');
try{const result=await client.mutate({mutation:gql\`mutation Run($inputJson:String!){legacyData{run(inputJson:$inputJson)}}\`,variables:{inputJson}});const outcome=result.extensions?.outcomes?.['legacyData.run'];if(result.errors?.length||!result.data?.legacyData?.run){status.dataset.error='true';await show(outcome==='rejected'?'Could not run. Check that you are signed in as the owner.':'Run outcome unknown. Check before running again.');return;}const receipt=JSON.parse(result.data.legacyData.run);await client.updateQuery({query:OUTPUT},()=>({programOutput:receipt.stdout+receipt.stderr}));await show('Finished with exit code '+receipt.exitCode+'.');}catch{status.dataset.error='true';await show('Run outcome unknown. Check before running again.');}finally{button.disabled=false;button.textContent='Run program';form.removeAttribute('aria-busy');}});
</script></body></html>`,
      identities: {
        "program-form": "program-form",
        "program-input": "program-input",
        "program-output": "program-output",
        "program-status": "program-status",
      },
      issues: [],
    };
  } catch {
    return {
      classification: "manual-blocked",
      html: null,
      issues: ["Native program requires compatible execution capabilities"],
      identities: {},
    };
  }
}
