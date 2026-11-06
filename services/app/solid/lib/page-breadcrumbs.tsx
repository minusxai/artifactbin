/* @jsxImportSource solid-js */
/** Resolved page navigation for the shared bar. Entries belong to one mounted route and URL. */
import { createContext, createEffect, createSignal, onCleanup, useContext, type Accessor, type JSX, type Setter } from 'solid-js';
import { useLocation } from '@solidjs/router';

export interface PageCrumb { label:string; href?:string }
interface Entry { address:string; crumbs:PageCrumb[] }
const Context=createContext<{entry:Accessor<Entry|null>;setEntry:Setter<Entry|null>}>();

export function PageBreadcrumbProvider(props:{children:JSX.Element}):JSX.Element {
 const [entry,setEntry]=createSignal<Entry|null>(null);
 return <Context.Provider value={{entry,setEntry}}>{props.children}</Context.Provider>;
}

/** Pages contribute authorized names; URL changes immediately invalidate the previous route's names. */
export function usePageBreadcrumbs(crumbs:Accessor<PageCrumb[]>):void {
 const context=useContext(Context);
 if(!context)return;
 const location=useLocation();
 createEffect(()=>{
  const entry={address:location.pathname+location.search,crumbs:crumbs()};
  context.setEntry(entry);
  onCleanup(()=>context.setEntry(current=>current===entry?null:current));
 });
}

export function useResolvedBreadcrumbs():Accessor<PageCrumb[]|null> {
 const context=useContext(Context);
 const location=useLocation();
 return ()=>{const entry=context?.entry();return entry?.address===location.pathname+location.search?entry.crumbs:null;};
}
