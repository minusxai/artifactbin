import type { CommentViewState } from '../../../contracts/src/comment-view-state';
import type { HtmlCommentViewCommand, HtmlCommentViewPort } from './comment-view-contract';
const SLOT=Symbol.for('artifactbin.html-comment-view.v1');
type Owner={ [SLOT]?: HtmlCommentViewPort };
export function installHtmlCommentView(owner:object,port:HtmlCommentViewPort|undefined):void { Object.defineProperty(owner,SLOT,{value:port,configurable:true}); }
export function withHtmlCommentView<T extends object>(owner:object,selection:T):T & {viewState?:CommentViewState;viewStateError?:string} {
 try { const saved=(owner as Owner)[SLOT]?.capture(); return saved ? {...selection,viewState:saved} : selection; }
 catch { return {...selection,viewStateError:'This view could not be saved. The comment will remember its target only.'}; }
}
/** Private return state never crosses the frame bridge. Closing restores only unchanged view fields. */
export function createHtmlCommentViewSession(owner:object) {
 let open:string|null=null; let request:number|undefined; let original:CommentViewState|null=null; let applied:CommentViewState|null=null;
 let error:{id:string;message:string}|null=null;
 let queue:Promise<unknown>=Promise.resolve();
 const returnView=async(port:HtmlCommentViewPort)=>{
  if(!original || !applied){original=null;applied=null;return;}
  const current=port.capture();
  const fields=(saved:CommentViewState)=> (saved.state.$html as {fields:Record<string,unknown>}).fields;
  if(current){
   const values=fields(current), before=fields(original), after=fields(applied);
   for(const key of Object.keys(values))if(JSON.stringify(values[key])===JSON.stringify(after[key]))values[key]=before[key];
   await port.restore(current);
  }
  original=null;applied=null;
 };
 return {
  get error(){return error;},
  receive(command:HtmlCommentViewCommand):Promise<boolean>{
   const work=async()=>{
    const next=command.openId??null;
    if(next===open && command.viewStateRequest===request)return false;
    const port=(owner as Owner)[SLOT];
    error=null;
    try {
     if(port && next!==open)await returnView(port);
     const saved=command.pins?.find(pin=>pin.id===next)?.viewState;
     if(next && saved){
      if(!port)throw new Error('No compatible view declaration.');
      original??=port.capture();
      await port.restore(saved);applied=port.capture();
     }
    }catch{if(next)error={id:next,message:'The saved view could not be restored. The app may have changed or has no compatible view declaration.'};}
    open=next;request=command.viewStateRequest;
    return true;
   };
   const result=queue.then(work,work);queue=result;return result;
  },
 };
}
