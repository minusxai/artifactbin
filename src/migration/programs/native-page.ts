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
      html: `<!doctype html><html><head><meta charset="utf-8"><script type="application/json" data-af="state">{"programInput":"null","programOutput":""}</script><title>${esc(input.title)}</title><script data-af="core" src="${esc(input.coreUrl)}"></script>${input.binding ? `<link rel="af-backend" data-af-name="legacyData" href="${esc(input.binding.backendHref)}">` : ""}</head><body><main><h1>${esc(input.title)}</h1><p>Run this program as its owner. Each run returns its output and exit code.</p><form data-af-id="program-form"><label>JSON input<textarea data-af-id="program-input">null</textarea></label><button ${input.binding ? "" : "disabled"}>Run</button></form><pre data-af-id="program-output" role="status"></pre></main><script type="module">
import {gql,client} from '@afbin/apollo';
const form=document.querySelector('[data-af-id="program-form"]'),input=document.querySelector('[data-af-id="program-input"]'),output=document.querySelector('[data-af-id="program-output"]');
const DRAFT=gql\`{programInput}\`,OUTPUT=gql\`{programOutput}\`,VIEW=gql\`{programInput programOutput}\`;
const view=client.watchQuery({query:VIEW}).subscribe(({data})=>{if(input.value!==(data.programInput??'null'))input.value=data.programInput??'null';output.textContent=data.programOutput??'';});
input.addEventListener('input',()=>client.updateQuery({query:DRAFT},()=>({programInput:input.value})));
const show=programOutput=>client.updateQuery({query:OUTPUT},()=>({programOutput}));
form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;try{const inputJson=JSON.stringify(JSON.parse(input.value));const result=await client.mutate({mutation:gql\`mutation Run($inputJson:String!){legacyData{run(inputJson:$inputJson)}}\`,variables:{inputJson}});if(result.errors?.length)throw Error('Program execution failed; do not retry an unknown outcome automatically.');if(!result.data?.legacyData?.run)throw Error('Program execution unavailable.');const receipt=JSON.parse(result.data.legacyData.run);await show(receipt.stdout+receipt.stderr+'\\nExit code: '+receipt.exitCode);}catch(error){await show(error.message);}finally{button.disabled=false;}});
</script></body></html>`,
      identities: {
        "program-form": "program-form",
        "program-input": "program-input",
        "program-output": "program-output",
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
