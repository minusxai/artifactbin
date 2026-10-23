import type {HtmlJson} from '@artifactbin/contracts';
export interface PreparedHtmlBackend {name:string;source:string;typeDefs:string;compiled:string;secretBindings?:string[]}
export interface HtmlBackendVersionRecord extends PreparedHtmlBackend {backendId:string;pageId:string;version:string;ownerId:string}
export interface HtmlBackendStoreValue {value:HtmlJson|null;version:number}
export interface HtmlBackendStoreWrite {ok:boolean;version:number}
