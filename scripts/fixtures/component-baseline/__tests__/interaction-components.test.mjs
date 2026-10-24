// @vitest-environment jsdom
import {afterEach,it,expect} from 'vitest';
import {registerSelect} from '../../../../services/app/lib/html-components/select';
import {registerDataTable} from '../../../../services/app/lib/html-components/data-table';
import {interactionBaselineFixtures} from '../interaction.mjs';
import {stateExpectationIssues} from '../../../lib/component-browser-baseline.mjs';
registerSelect();registerDataTable();
afterEach(()=>document.body.replaceChildren());
const pair=id=>interactionBaselineFixtures.find(fixture=>fixture.id===id);
const mount=fixture=>{document.body.innerHTML=fixture.newHtml;new Function(fixture.setup)();};
function selectState(){const root=document.querySelector('af-select'),trigger=root.querySelector('button'),visible=root.cloneNode(true);visible.querySelectorAll('[hidden]').forEach(node=>node.remove());return {text:visible.textContent,controls:[{role:'button',name:trigger.getAttribute('aria-label'),expanded:trigger.getAttribute('aria-expanded'),focused:document.activeElement===trigger},...[...root.querySelectorAll('[role=option]')].filter(option=>!option.closest('[hidden]')).map(option=>({role:'option',name:option.textContent,selected:option.getAttribute('aria-selected')}))],rows:[]};}
function tableState(){return {text:document.body.textContent,controls:[...document.querySelectorAll('th')].map(th=>({role:'columnheader',name:th.querySelector('button')?.getAttribute('aria-label')||th.getAttribute('aria-label'),sort:th.getAttribute('aria-sort')})),rows:[...document.querySelectorAll('tr')].map(tr=>[...tr.cells].map(td=>td.textContent))};}
it('executes the authored candidate choice and detects a lost controlled write',()=>{
  const fixture=pair('select-choice');mount(fixture);
  document.querySelector('af-select button').click();
  [...document.querySelectorAll('[role=option]')].find(option=>option.textContent==='Grace').click();
  expect(stateExpectationIssues(fixture.states[0].expected,selectState())).toEqual([]);
  mount(fixture);
  // Negative control: cancel the real change intent before its author adapter accepts it.
  document.querySelector('af-select').addEventListener('af-change',event=>{event.stopImmediatePropagation();event.preventDefault();},{capture:true});
  document.querySelector('af-select button').click();
  [...document.querySelectorAll('[role=option]')].find(option=>option.textContent==='Grace').click();
  expect(stateExpectationIssues(fixture.states[0].expected,selectState())).not.toEqual([]);
});
it('executes real sorting and detects an ignored second sort activation',()=>{
  const fixture=pair('data-table-sort-cycle');mount(fixture);
  const header=document.querySelector('button[aria-label="Sort by score"]');
  header.click();expect(stateExpectationIssues(fixture.states[0].expected,tableState())).toEqual([]);
  // Negative control: preserve the populated table but swallow the next sort activation.
  header.addEventListener('click',event=>event.stopImmediatePropagation(),{capture:true,once:true});
  header.click();expect(stateExpectationIssues(fixture.states[1].expected,tableState())).not.toEqual([]);
  header.click();expect(stateExpectationIssues(fixture.states[1].expected,tableState())).toEqual([]);
  header.click();expect(stateExpectationIssues(fixture.states[2].expected,tableState())).toEqual([]);
});
