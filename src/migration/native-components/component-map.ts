/** Offline lowering rules pinned to reviewed native component interfaces. No
 * renderer, legacy runtime or target browser module is imported by this file.
 * Source provenance at the target revision: services/app/lib/html-components/
 * {button,dialog,input,textarea,segmented,select,data-table,user,switch,slider,
 * progress,date-picker}.ts. Semantic CSS is a baseline, not pixel equivalence.
 * Grid geometry requires a separate adapter (story-ui/grid-layout.ts); authored
 * utility classes and Number/Cell formatter output require explicit receipts.
 */
export const NATIVE_COMPONENT_TARGET = 'e7cb720cf029acded3a427fe951699e99c425873';
export type NativeAttributeKind = 'string' | 'number' | 'boolean' | readonly string[];
export interface NativeComponentRule {
  tag: string;
  htmlTag: string;
  kind: 'semantic' | 'native';
  module?: string;
  register?: string;
  attributes?: Readonly<Record<string, NativeAttributeKind>>;
  properties?: readonly string[];
  parent?: readonly string[];
  generatedClass?: string;
}
const rules: NativeComponentRule[] = [];
const semantic = (tag: string, htmlTag: string, generatedClass?: string) => rules.push({tag,htmlTag,kind:'semantic',generatedClass});
for(const [tag,htmlTag,css] of [
 ['Card','section','native-card'],['CardHeader','header','native-card-header'],['CardTitle','h2','native-card-title'],['CardDescription','p','native-muted'],['CardContent','div','native-card-content'],['CardFooter','footer','native-card-footer'],['CardAction','div','native-card-action'],
 ['Grid','div','native-grid'],['GridItem','div','native-grid-item'],['Alert','aside','native-alert'],['AlertTitle','h3','native-alert-title'],['AlertDescription','div','native-alert-description'],['Badge','span','native-badge'],
 ['Table','table','native-table'],['TableHeader','thead',''],['TableBody','tbody',''],['TableFooter','tfoot',''],['TableRow','tr',''],['TableHead','th',''],['TableCell','td',''],['TableCaption','caption',''],['Number','span',''],['Cell','span',''],
] as const) semantic(tag,htmlTag,css);
const native = (tag: string, module: string, register: string, attributes: NativeComponentRule['attributes']={}, properties: readonly string[]=[], parent?: readonly string[]) => {
 const htmlTag='af-'+tag.replace(/[A-Z]/g,(letter,index)=>(index?'-':'')+letter.toLowerCase());
 rules.push({tag,htmlTag,kind:'native',module,register,attributes,properties,parent});
};
native('Button','button','registerButton',{type:['button','submit','reset'],variant:['default','destructive','outline','secondary','ghost','link'],size:['default','xs','sm','lg','icon','icon-xs','icon-sm','icon-lg'],disabled:'boolean',busy:'boolean',label:'string',name:'string',value:'string'});
native('Dialog','dialog','registerDialog',{defaultOpen:'boolean'},['open']);
for(const tag of ['DialogTrigger','DialogClose'] as const)native(tag,'dialog','registerDialog',{disabled:'boolean'},[],['Dialog']);
native('DialogContent','dialog','registerDialog',{},[],['Dialog']);
const textAttributes={label:'string',name:'string',placeholder:'string',disabled:'boolean',readOnly:'boolean',required:'boolean',autoFocus:'boolean',minLength:'number',maxLength:'number',defaultValue:'string'} as const;
native('Input','input','registerInput',{...textAttributes,type:['text','number','email','url','search','password'],min:'number',max:'number',step:'number'},['value']);
native('Textarea','textarea','registerTextarea',{...textAttributes,rows:'number',resize:['none','vertical','horizontal','both']},['value']);
native('Segmented','segmented','registerSegmented',{label:'string',disabled:'boolean',orientation:['horizontal','vertical']},['options','value','defaultValue']);
native('Select','select','registerSelect',{label:'string',placeholder:'string',disabled:'boolean',multiple:'boolean',searchable:'boolean'},['options','value']);
native('DataTable','data-table','registerDataTable',{label:'string',height:'number',sticky:'boolean',transpose:'boolean',header:'string',edge:'boolean',rowKey:'string'},['data','columns','sort','metrics']);
native('User','user','registerUser',{fallback:'string',size:['sm','md','lg'],avatar:'boolean',link:'boolean',decorative:'boolean',mode:['user','avatar','handle']});
native('Switch','switch','registerSwitch',{label:'string',disabled:'boolean',defaultChecked:'boolean'},['checked']);
native('Slider','slider','registerSlider',{label:'string',min:'number',max:'number',step:'number',format:'string',prefix:'string',suffix:'string',disabled:'boolean',readOnly:'boolean'},['value']);
native('Progress','progress','registerProgress',{label:'string'},['value']);
native('DatePicker','date-picker','registerDatePicker',{label:'string',placeholder:'string',min:'string',max:'string',disabled:'boolean',readOnly:'boolean'},['value']);
const byTag = new Map(rules.map(rule=>[rule.tag,Object.freeze(rule)]));
export function nativeComponentRule(tag: string): NativeComponentRule | undefined { return byTag.get(tag); }
/** Only semantic defaults, not a replacement compiler for authored utility CSS. */
export const NATIVE_SEMANTIC_CSS = '.native-card,.native-alert{border:1px solid var(--border,#ccc);border-radius:var(--radius,.375rem);background:var(--card,#fff);color:var(--foreground,#222)}.native-card-header,.native-card-content,.native-card-footer,.native-alert{padding:1rem}.native-card-title,.native-alert-title{margin:0;font-weight:600}.native-muted{color:var(--muted-foreground,#666)}.native-grid{display:grid;min-width:0}.native-grid-item{min-width:0}.native-table{width:100%;border-collapse:collapse}.native-table th,.native-table td{padding:.5rem;text-align:start;border-bottom:1px solid var(--border,#ccc)}.native-badge{display:inline-block;border:1px solid var(--border,#ccc);border-radius:.25rem;padding:.125rem .375rem}';
