/** Authored pairs for the real pinned compiler/reader. No old DOM or CSS is synthesized. */
const revision='8eaac63810b66eb575b018be89bb63443e1b7aaf';
const controls={revision,path:'services/app/lib/islands/kit/controls.tsx',sha256:'4ae83709bebf256ab1050a702457173781ce564ab9a7cf9a869cfa0c20ede18a'};
const disclosure={revision,path:'services/app/lib/islands/kit/disclosure.tsx',sha256:'6e3a49d1210a8cae07e0dcda0ab680ad80feb1fa52c5f65e267b85646ecf63b7'};
const initial={id:'initial',actions:[]};
const action=(role,name,action,key)=>({role,name,action,...(key?{key}:{})});
const focus=(role,name)=>({id:'focus',actions:[action(role,name,'focus')]});
const press=(id,role,name,key)=>({id,actions:[action(role,name,'focus'),action(role,name,'press',key)]});
const click=(id,name)=>({id,actions:[action('button',name,'click')]});
const bind=(tag,property)=>`const field=document.querySelector('${tag}');field.addEventListener('af-change',event=>{field.${property}=event.detail.value;});`;
const scalarLimit='Viewer reload/persistence and shared backend behavior are outside these independent captures.';
/** @type {import('./controls-contract').ControlBaselineFixture[]} */
const fixtures=[
  {
    id:'input',family:'Input',modules:['input'],provenance:{...controls,exports:['Input']},
    oldJsx:'<Helmet><Value name="fullName" type="string" default="Ada" /></Helmet><div><Input label="Full name" value="$fullName" placeholder="Enter name" /><Input label="Unavailable name" value="Ada" disabled /></div>',
    newHtml:'<div><af-input label="Full name" default-value="Ada" placeholder="Enter name"></af-input><af-input label="Unavailable name" default-value="Ada" disabled></af-input></div>',
    setup:bind('af-input','value'),states:[initial,focus('textbox','Full name'),{id:'append',actions:[action('textbox','Full name','focus'),action('textbox','Full name','press','End'),action('textbox','Full name','press','x')]}],
    limitations:[scalarLimit,'Typing is captured immediately; original debounced reader-store persistence is not asserted.'],
  },
  {
    id:'textarea',family:'Textarea',modules:['textarea'],provenance:{...controls,exports:['Textarea']},
    oldJsx:'<Helmet><Value name="notes" type="string" default="Review details" /></Helmet><div><Textarea label="Notes" value="$notes" rows={3} /><Textarea label="Unavailable notes" value="Review details" rows={3} disabled /></div>',
    newHtml:'<div><af-textarea label="Notes" default-value="Review details" rows="3"></af-textarea><af-textarea label="Unavailable notes" default-value="Review details" rows="3" disabled></af-textarea></div>',
    setup:bind('af-textarea','value'),states:[initial,focus('textbox','Notes'),{id:'newline',actions:[action('textbox','Notes','focus'),action('textbox','Notes','press','End'),action('textbox','Notes','press','Enter'),action('textbox','Notes','press','x')]}],
    limitations:[scalarLimit,'Original debounce completion and textarea user resizing are not asserted.'],
  },
  {
    id:'slider',family:'Slider',modules:['slider'],provenance:{...controls,exports:['Slider']},
    oldJsx:'<Helmet><Value name="level" type="number" default={40} /></Helmet><div><Slider label="Level" value="$level" min={0} max={100} step={10} suffix="%" /><Slider label="Unavailable level" value={40} min={0} max={100} step={10} suffix="%" disabled /></div>',
    newHtml:'<div><af-slider label="Level" default-value="40" min="0" max="100" step="10" suffix="%"></af-slider><af-slider label="Unavailable level" default-value="40" min="0" max="100" step="10" suffix="%" disabled></af-slider></div>',
    setup:bind('af-slider','value'),states:[initial,focus('slider','Level'),press('increment','slider','Level','ArrowRight'),press('maximum','slider','Level','End')],limitations:[scalarLimit,'Pointer dragging and nullable/invalid numeric coercion are not captured.'],
  },
  {
    id:'switch',family:'Switch',modules:['switch'],provenance:{...controls,exports:['Switch']},
    oldJsx:'<Helmet><Value name="enabled" type="boolean" default={false} /></Helmet><div><Switch label="Notifications" checked="$enabled" /><Switch label="Unavailable notifications" checked={false} disabled /></div>',
    newHtml:'<div><af-switch label="Notifications"></af-switch><af-switch label="Unavailable notifications" disabled></af-switch></div>',
    setup:bind('af-switch','checked'),states:[initial,focus('switch','Notifications'),press('space','switch','Notifications','Space')],limitations:[scalarLimit,'Pointer gestures are outside these keyboard captures.'],
  },
  {
    id:'segmented',family:'Segmented',modules:['segmented'],provenance:{...controls,exports:['Segmented']},
    oldJsx:'<Helmet><Value name="period" type="string" default="Now" /></Helmet><Segmented label="Period" value="$period" options={["Now","Later"]} />',
    newHtml:'<af-segmented label="Period"></af-segmented>',
    setup:'const field=document.querySelector("af-segmented");field.options=["Now","Later"];field.value="Now";field.addEventListener("af-change",event=>{field.value=event.detail.value;});',
    states:[initial,focus('button','Now'),click('later','Later'),press('keyboard-later','button','Later','Enter')],
    limitations:[scalarLimit,'Original Segmented has ordinary buttons and no roving arrow navigation. Candidate-only arrow behavior is not a parity scenario.','Nullable options and disabled groups are outside these captures.'],
  },
  {
    id:'accordion',family:'Accordion',modules:['accordion'],
    provenance:{revision,path:'services/app/lib/islands/kit/accordion.tsx',sha256:'e78a88b7f42d51d186bce565bfab52b9590ce5d3c7ac2f2ce90b2d4bdb9f436a',exports:['Accordion','AccordionItem','AccordionTrigger','AccordionContent']},
    oldJsx:'<Accordion type="single" collapsible defaultValue="first"><AccordionItem value="first"><AccordionTrigger>First section</AccordionTrigger><AccordionContent>First section details</AccordionContent></AccordionItem><AccordionItem value="second"><AccordionTrigger>Second section</AccordionTrigger><AccordionContent>Second section details</AccordionContent></AccordionItem><AccordionItem value="blocked" disabled><AccordionTrigger>Unavailable section</AccordionTrigger><AccordionContent>Unavailable details</AccordionContent></AccordionItem></Accordion>',
    newHtml:'<af-accordion type="single" collapsible default-value="first"><af-accordion-item value="first"><af-accordion-trigger><button>First section</button></af-accordion-trigger><af-accordion-content>First section details</af-accordion-content></af-accordion-item><af-accordion-item value="second"><af-accordion-trigger><button>Second section</button></af-accordion-trigger><af-accordion-content>Second section details</af-accordion-content></af-accordion-item><af-accordion-item value="blocked" disabled><af-accordion-trigger><button>Unavailable section</button></af-accordion-trigger><af-accordion-content>Unavailable details</af-accordion-content></af-accordion-item></af-accordion>',
    states:[initial,click('second','Second section'),press('collapse-first','button','First section','Space')],
    limitations:['Only actual original single-selection behavior is paired; its multiple and arrow-navigation behavior is not implemented.','Closed subtree retention and reload/comment-state behavior are outside these captures.'],
  },
  {
    id:'collapsible',family:'Collapsible',modules:['collapsible'],provenance:{...disclosure,exports:['Collapsible','CollapsibleTrigger','CollapsibleContent']},
    oldJsx:'<Collapsible><CollapsibleTrigger>More details</CollapsibleTrigger><CollapsibleContent><p>Additional information</p><button>Inside details</button></CollapsibleContent></Collapsible>',
    newHtml:'<af-collapsible><af-collapsible-trigger><button>More details</button></af-collapsible-trigger><af-collapsible-content><p>Additional information</p><button>Inside details</button></af-collapsible-content></af-collapsible>',
    states:[initial,click('open','More details'),press('keyboard-open','button','More details','Enter'),{id:'closed-again',actions:[action('button','More details','click'),action('button','More details','click')]}],
    limitations:['Original root disabled does not disable its trigger; no claimed disabled-root parity.','Reload/comment-state and closed subtree retention are outside these captures.'],
  },
  {
    id:'popover',family:'Popover',modules:['popover'],provenance:{...disclosure,exports:['Popover','PopoverTrigger','PopoverContent']},
    oldJsx:'<Popover><PopoverTrigger>Show details</PopoverTrigger><PopoverContent aria-label="Details"><p>Additional information</p><button>Inside popover</button></PopoverContent></Popover>',
    newHtml:'<af-popover><af-popover-trigger><button>Show details</button></af-popover-trigger><af-popover-content aria-label="Details"><p>Additional information</p><button>Inside popover</button></af-popover-content></af-popover>',
    states:[initial,click('open','Show details'),{id:'escape',actions:[action('button','Show details','click'),action('button','Inside popover','focus'),action('button','Inside popover','press','Escape')]}],
    limitations:['Default bottom/center placement only; edge collision, outside pointer dismissal and nested overlays are outside these captures.'],
  },
];

/** Explicit outcomes make a nonfunctional original or candidate fail before pixel comparison.
 * This uses the shared BrowserParityFixture expected-state contract. */
export const controlBaselineFixtures=fixtures.map(fixture=>({
  ...fixture,
  states:fixture.states.map(state=>{
    let expected;
    if(fixture.id==='input')expected={roles:[{role:'textbox',name:'Full name',value:state.id==='append'?'Adax':'Ada'},{role:'textbox',name:'Unavailable name',disabled:true,value:'Ada'}]};
    if(fixture.id==='textarea')expected={roles:[{role:'textbox',name:'Notes',value:state.id==='newline'?'Review details\nx':'Review details'},{role:'textbox',name:'Unavailable notes',disabled:true,value:'Review details'}]};
    if(fixture.id==='slider')expected={roles:[{role:'slider',name:'Level',value:state.id==='increment'?'50':state.id==='maximum'?'100':'40'},{role:'slider',name:'Unavailable level',disabled:true,value:'40'}]};
    if(fixture.id==='switch')expected={roles:[{role:'switch',name:'Notifications',checked:state.id==='space'},{role:'switch',name:'Unavailable notifications',disabled:true,checked:false}]};
    if(fixture.id==='segmented'){
      const later=state.id==='later'||state.id==='keyboard-later';
      expected={roles:[{role:'button',name:'Now',pressed:!later},{role:'button',name:'Later',pressed:later}]};
    }
    if(fixture.id==='accordion'){
      const first=state.id==='initial',second=state.id==='second';
      expected={roles:[{role:'button',name:'First section',expanded:first},{role:'button',name:'Second section',expanded:second},{role:'button',name:'Unavailable section',disabled:true}],textIncludes:first?['First section details']:second?['Second section details']:[],hiddenText:[...(first?[]:['First section details']),...(second?[]:['Second section details']),'Unavailable details']};
    }
    if(fixture.id==='collapsible'){
      const open=state.id==='open'||state.id==='keyboard-open';
      expected={roles:[{role:'button',name:'More details',expanded:open}],...(open?{textIncludes:['Additional information'],roles:[{role:'button',name:'More details',expanded:true},{role:'button',name:'Inside details'}]}:{hiddenText:['Additional information'],rolesAbsent:[{role:'button',name:'Inside details'}]})};
    }
    if(fixture.id==='popover'){
      const open=state.id==='open';
      expected={roles:[{role:'button',name:'Show details',expanded:open},...(open?[{role:'dialog',name:'Details'}]:[])],...(open?{textIncludes:['Additional information']}:{hiddenText:['Additional information'],rolesAbsent:[{role:'dialog',name:'Details'}]})};
    }
    return {...state,expected};
  }),
}));
