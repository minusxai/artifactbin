import {createContext,useContext} from 'react';
export interface InboxItem {id:string;artifact_id:string|null;user_id:string;status:string|null;direction:string|null;sender_id:string;username:string|null;kind:string;source:string|null;title:string|null;read_at:string|null;revision:number;first_update_id?:string|null}
export interface InboxState {autoAccept:boolean;notifications:InboxItem[];blocks:Array<{user_id:string;username:string|null}>;unread:number;next:number|null}
export const NotificationContext=createContext<{state:InboxState|null;error:string;load:(input?:object)=>Promise<void>;open:()=>void;close?:()=>void;loadMore?:()=>Promise<void>}|null>(null);
export const useNotifications=()=>useContext(NotificationContext);
