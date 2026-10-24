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
