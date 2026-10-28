/**
 * A small semantic contract shared by component fixtures and their browser gate.
 * Recorded SSR comparisons and candidate interaction contracts are distinct evidence.
 * @typedef {{role:string,name:string,selected?:boolean,disabled?:boolean,hidden?:boolean,focused?:boolean,orientation?:string}} SemanticNode
 * @typedef {{type:'focus'|'click'|'key',name?:string,key?:string}} ComponentAction
 * @typedef {{id:string,theme:'light'|'dark',viewport:{width:number,height:number},actions:ComponentAction[],expected:SemanticNode[]}} ComponentCase
 * @typedef {{id:string,oldJsx:string,newHtml:string,reference:{kind:'recorded-react-ssr',key:string},cases:ComponentCase[]}} ComponentParityFixture
 */

/** Runs unchanged in JSDOM or the browser. Intentionally limited to these fixture roles. */
export function semanticSnapshot(root) {
  const doc = root.ownerDocument ?? root;
  return [...root.querySelectorAll('[role="tablist"],[role="tab"],[role="tabpanel"]')].map(node => {
    const role = node.getAttribute('role');
    const labelled = node.getAttribute('aria-labelledby');
    const name = (node.getAttribute('aria-label') ?? (labelled ? labelled.split(/\s+/).map(id => doc.getElementById(id)?.textContent ?? '').join(' ') : role === 'tab' ? node.textContent : '')).replace(/\s+/g,' ').trim();
    const result = {role,name};
    if (role === 'tab') { result.selected = node.getAttribute('aria-selected') === 'true'; result.disabled = node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true'; }
    if (role === 'tabpanel') result.hidden = node.hidden || node.getAttribute('aria-hidden') === 'true';
    if (role === 'tablist') result.orientation = node.getAttribute('aria-orientation') ?? 'horizontal';
    result.focused = doc.activeElement === node;
    return result;
  });
}

/** Expected rows are ordered, exact in count, and partial in fields. No class or generated-id equality. */
export function semanticDifferences(expected, actual) {
  const errors = [];
  if (expected.length !== actual.length) errors.push(`node count: expected ${expected.length}, received ${actual.length}`);
  for (const [index, node] of expected.entries()) for (const [field,value] of Object.entries(node)) {
    if (actual[index]?.[field] !== value) errors.push(`node ${index} ${field}: expected ${JSON.stringify(value)}, received ${JSON.stringify(actual[index]?.[field])}`);
  }
  return errors;
}

/** @returns {ComponentParityFixture[]} */
export function tabsParityFixtures() {
  return ['default','line'].map(variant => {
    const oldJsx = `<Tabs defaultValue="one"><TabsList${variant === 'line' ? ' variant="line"' : ''}><TabsTrigger value="one">One</TabsTrigger></TabsList></Tabs>`;
    return {id:`tabs-${variant}`,oldJsx,newHtml:`<af-tabs default-value="one"><af-tabs-list variant="${variant}"><af-tabs-trigger value="one">One</af-tabs-trigger></af-tabs-list></af-tabs>`,reference:{kind:'recorded-react-ssr',key:JSON.stringify({markup:oldJsx,data:null})},cases:[]};
  });
}

export const tabsInteractionHtml = `<button id="before">Before</button><af-tabs default-value="one"><af-tabs-list aria-label="Sections"><af-tabs-trigger value="one">One</af-tabs-trigger><af-tabs-trigger value="blocked" disabled>Unavailable</af-tabs-trigger><af-tabs-trigger value="two">Two</af-tabs-trigger></af-tabs-list><af-tabs-content value="one"><input aria-label="Retained input" value="Keep me"></af-tabs-content><af-tabs-content value="two">Second panel</af-tabs-content></af-tabs><button id="after">After</button>`;
const state = (selected, focused) => [
  {role:'tablist',name:'Sections',orientation:'horizontal'},
  ...['One','Unavailable','Two'].map(name => ({role:'tab',name,selected:name===selected,disabled:name==='Unavailable',focused:name===focused})),
  ...['One','Two'].map(name => ({role:'tabpanel',name,hidden:name!==selected})),
];
/** Candidate contract cases, not captured old-browser behavior or screenshot parity. */
export const tabsInteractionCases = [
  {id:'initial',actions:[],expected:state('One')},
  {id:'arrow-skips-disabled',actions:[{type:'focus',name:'One'},{type:'key',key:'ArrowRight'}],expected:state('Two','Two')},
  {id:'home',actions:[{type:'focus',name:'Two'},{type:'key',key:'Home'}],expected:state('One','One')},
  {id:'end',actions:[{type:'focus',name:'One'},{type:'key',key:'End'}],expected:state('Two','Two')},
  {id:'wrap',actions:[{type:'focus',name:'One'},{type:'key',key:'ArrowLeft'}],expected:state('Two','Two')},
  {id:'click',actions:[{type:'click',name:'Two'}],expected:state('Two','Two')},
];

/** @typedef {{family:string,html:string,subject:string,evidence:'candidate-browser-contract',setup?:string}} BrowserComponentFixture */
/** Synthetic, author-owned fixtures. These do not claim a captured old-browser baseline. @type {BrowserComponentFixture[]} */
export const componentBrowserFixtures = [
  {family:'button',subject:'af-button',html:`<button id="before">Before</button><form id="form"><div class="gallery"><af-button id="action">Run action</af-button><af-button disabled>Disabled action</af-button><af-button busy>Busy action</af-button><af-button variant="outline">Outline</af-button><af-button variant="secondary">Secondary</af-button><af-button variant="ghost">Ghost</af-button><af-button variant="link">Link</af-button><af-button type="submit">Submit form</af-button></div></form>`},
  {family:'switch',subject:'af-switch',html:`<button id="before">Before</button><div class="gallery"><af-switch label="Notifications"></af-switch><af-switch disabled label="Disabled notifications"></af-switch><af-switch read-only label="Read only notifications"></af-switch></div>`},
  {family:'progress',subject:'af-progress',html:`<h1>Progress</h1><af-progress label="Upload" value="42"></af-progress><af-progress label="Pending"></af-progress>`},
  {family:'collapsible',subject:'af-collapsible',html:`<button id="before">Before</button><af-collapsible><af-collapsible-trigger>Show details</af-collapsible-trigger><af-collapsible-content><label>Retained detail<input value="Keep detail"></label></af-collapsible-content></af-collapsible><af-collapsible disabled><af-collapsible-trigger>Disabled details</af-collapsible-trigger><af-collapsible-content>Must stay hidden</af-collapsible-content></af-collapsible>`},
  {family:'dialog',subject:'af-dialog',html:`<button id="before">Before</button><af-dialog><af-dialog-trigger>Open settings</af-dialog-trigger><af-dialog-content><af-dialog-header><af-dialog-title>Settings</af-dialog-title><af-dialog-description>Adjust this local example.</af-dialog-description></af-dialog-header><label>Display name<input value="Sample"></label><af-dialog-footer><af-dialog-close>Close settings</af-dialog-close></af-dialog-footer></af-dialog-content></af-dialog><af-dialog><af-dialog-trigger disabled>Disabled dialog</af-dialog-trigger><af-dialog-content><af-dialog-title>Unavailable dialog</af-dialog-title></af-dialog-content></af-dialog>`},
  {family:'slider',subject:'af-slider',html:`<button id="before">Before</button><div class="gallery"><af-slider label="Volume" min="0" max="100" step="5" default-value="25"></af-slider><af-slider disabled label="Disabled volume" default-value="25"></af-slider><af-slider readonly label="Read only volume" default-value="25"></af-slider></div>`},
  {family:'text-controls',subject:'af-input',html:`<button id="before">Before</button><div class="gallery"><af-input label="Name" default-value="Initial"></af-input><af-input type="number" label="Quantity" default-value="2" min="0" max="10"></af-input><af-input label="Disabled name" disabled default-value="Locked"></af-input><af-input label="Read only name" readonly default-value="Fixed"></af-input><af-textarea label="Notes" default-value="Initial notes"></af-textarea><af-textarea disabled label="Disabled notes" default-value="Locked notes"></af-textarea><af-textarea readonly label="Read only notes" default-value="Fixed notes"></af-textarea></div>`},
  {family:'accordion',subject:'af-accordion',html:`<button id="before">Before</button><af-accordion collapsible default-value="one"><af-accordion-item value="one"><af-accordion-trigger>First section</af-accordion-trigger><af-accordion-content><label>Retained accordion input<input value="Keep section"></label></af-accordion-content></af-accordion-item><af-accordion-item value="blocked" disabled><af-accordion-trigger>Unavailable section</af-accordion-trigger><af-accordion-content>Disabled panel</af-accordion-content></af-accordion-item><af-accordion-item value="three"><af-accordion-trigger>Third section</af-accordion-trigger><af-accordion-content>Third panel</af-accordion-content></af-accordion-item></af-accordion><af-accordion type="multiple"><af-accordion-item value="a"><af-accordion-trigger>Multiple A</af-accordion-trigger><af-accordion-content>A content</af-accordion-content></af-accordion-item><af-accordion-item value="b"><af-accordion-trigger>Multiple B</af-accordion-trigger><af-accordion-content>B content</af-accordion-content></af-accordion-item></af-accordion>`},
  {family:'select',subject:'af-select',html:`<button id="before">Before</button><div class="gallery"><af-select id="single-picker" label="Color" default-value='"red"' options='[{"value":"red","label":"Red"},{"value":"blue","label":"Blue"}]'></af-select><af-select id="multiple-picker" multiple allow-create label="Tags" options='["Red","Blue"]'></af-select><af-select label="Disabled picker" disabled options='["One"]'></af-select></div>`},
  // This candidate-only contract opts into the optional null-selection action exercised by gate-html-components.
  {family:'date-picker',subject:'af-date-picker',html:`<button id="before">Before</button><div class="gallery"><af-date-picker label="Appointment" default-value="2024-01-15" min="2024-01-10" max="2024-02-20" show-clear></af-date-picker><af-date-picker disabled label="Disabled appointment"></af-date-picker><af-date-picker readonly label="Read only appointment"></af-date-picker></div>`},
  {family:'segmented',subject:'af-segmented',html:`<button id="before">Before</button><div class="gallery"><af-segmented label="Period"></af-segmented><af-segmented label="Disabled period" disabled></af-segmented></div>`,setup:`for(const node of document.querySelectorAll('af-segmented')){node.options=[{value:1,label:'One'},{value:2,label:'Two'},{value:3,label:'Three'}];node.defaultValue=1;}`},
  {family:'avatar-icon',subject:'af-avatar',html:`<div class="gallery"><af-avatar id="portrait"><af-avatar-image src="/avatar.svg" alt="Sample portrait" data-af-id="portrait-image"></af-avatar-image><af-avatar-fallback data-af-id="portrait-fallback">SP</af-avatar-fallback><af-avatar-badge>Online</af-avatar-badge></af-avatar><af-avatar id="missing-portrait" size="lg"><af-avatar-image src="/missing-avatar.svg" alt="Missing portrait"></af-avatar-image><af-avatar-fallback>AB</af-avatar-fallback></af-avatar><af-icon name="Check" label="Complete"></af-icon><af-icon name="Check"></af-icon><af-icon name="unknown-test-glyph" label="Unknown icon"></af-icon></div>`},
  {family:'file-upload',subject:'af-file-upload',html:`<button id="before">Before</button><af-file-upload label="Attachments" dataset="fixture-files" multiple accept=".txt" max-files="3" max-bytes="64"></af-file-upload><af-file-upload disabled label="Disabled attachments"></af-file-upload>`},
  {family:'slide-deck',subject:'af-slide-deck',html:`<button id="before">Before</button><af-slide-deck label="Example deck"><af-slide title="Opening" id="opening-slide" data-af-id="opening-slide-node"><h1 data-af-id="opening-heading">Opening</h1><p>First authored slide.</p><label>Slide input<input value="Preserved"></label></af-slide><af-slide title="Closing" data-af-id="closing-slide-node"><h1>Closing</h1><p>Second authored slide.</p></af-slide></af-slide-deck>`},
].map(fixture=>({...fixture,evidence:'candidate-browser-contract'}));

/** WCAG relative luminance contrast for opaque sRGB pixel triples. */
export function contrastRatio(first, second) {
  const luminance = rgb => rgb.map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const a=luminance(first), b=luminance(second);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

/** Duplicate DOM ids and annotation identities are independently invalid across the live document. */
export function duplicateIdentities(root) {
  const duplicates=[];
  for(const attribute of ['id','data-af-id']) {
    const counts=new Map();
    for(const node of root.querySelectorAll(`[${attribute}]`)){const value=node.getAttribute(attribute);if(value)counts.set(value,(counts.get(value)??0)+1);}
    for(const [value,count] of counts)if(count>1)duplicates.push({attribute,value,count});
  }
  return duplicates;
}
