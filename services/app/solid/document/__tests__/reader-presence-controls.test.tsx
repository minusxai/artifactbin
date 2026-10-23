/* @jsxImportSource solid-js */
import {createSignal} from 'solid-js';
import {expect,it,vi} from 'vitest';
import {screen,fireEvent} from '@testing-library/dom';
import {render} from '../../__tests__/helpers';
import type {ReaderPreferences,PresenceViewer} from '@/lib/html-presence/contract';
import {ReaderPresenceControls} from '../ReaderPresenceControls';
const defaults:ReaderPreferences={visible:true,shareCursor:true,shareSelection:true,showCursors:true,showSelections:true};
const viewers:PresenceViewer[]=[{id:'one',label:'Alex',revision:'1',seen:0,cursor:null,selection:null},{id:'two',label:'Guest reader',revision:'1',seen:0,cursor:null,selection:null}];
it('names the readers and exposes all five independent privacy preferences',()=>{
 const changed=vi.fn();const [preferences,setPreferences]=createSignal(defaults);
 const view=render(()=><ReaderPresenceControls preferences={preferences()} viewers={viewers} onChange={(name,value)=>{changed(name,value);setPreferences(p=>({...p,[name]:value}));}}/>);
 const trigger=view.getByRole('button',{name:'Readers · 2'});expect(trigger).toHaveAttribute('aria-expanded','false');fireEvent.click(trigger);
 expect(screen.getByText('Alex')).toBeVisible();expect(screen.getByText('Guest reader')).toBeVisible();
 const settings=[['visible','Show me to other readers'],['shareCursor','Share my cursor'],['shareSelection','Share my selections'],['showCursors','Show other cursors'],['showSelections','Show other selections']] as const;
 for(const [name,label] of settings){const toggle=screen.getByRole('switch',{name:label});expect(toggle).toHaveAttribute('aria-checked','true');fireEvent.click(toggle);expect(changed).toHaveBeenLastCalledWith(name,false);expect(toggle).toHaveAttribute('aria-checked','false');}
 fireEvent.keyDown(document,{key:'Escape'});expect(trigger).toHaveAttribute('aria-expanded','false');expect(screen.queryByRole('switch')).toBeNull();
});
it('updates the reader count and provides an empty state without opening itself',()=>{
 const [people,setPeople]=createSignal<readonly PresenceViewer[]>([]);
 const view=render(()=><ReaderPresenceControls preferences={defaults} viewers={people()} onChange={()=>{}}/>);
 const trigger=view.getByRole('button',{name:'Readers · 0'});fireEvent.click(trigger);expect(screen.getByText('No other readers here')).toBeVisible();
 setPeople(viewers);expect(trigger).toHaveAccessibleName('Readers · 2');expect(screen.queryByText('No other readers here')).toBeNull();expect(screen.getByText('Alex')).toBeVisible();
});
