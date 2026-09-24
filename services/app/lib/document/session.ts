/** Buffered editing without text rebasing. Pending keystrokes survive slow saves and failures. */
import type {DocumentEdit,DocumentEditResult,DocumentSnapshot,RichDocument} from '@artifactbin/contracts';
import {applyDocumentOperations,assertDocument,diffDocument,documentChanges} from './model';
export type DocumentSaveStatus='saved'|'pending'|'saving'|'offline'|'conflict'|'invalid';
export class DocumentSession {
 private base:DocumentSnapshot;
 private draft:RichDocument;
 private pending:{request:DocumentEdit;document:RichDocument}|null=null;
 private running=false;
 private listeners=new Set<()=>void>();
 status:DocumentSaveStatus='saved';
 detail='';
 constructor(snapshot:DocumentSnapshot,private send:(edit:DocumentEdit)=>Promise<DocumentEditResult>){this.base=snapshot;this.draft=snapshot.document;}
 get document():RichDocument{return this.draft;}
 get version():number{return this.base.version;}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 private emit(){for(const listener of this.listeners)listener();}
 update(document:RichDocument):void{
  assertDocument(document);this.draft=document;
  if(!['conflict','invalid','offline'].includes(this.status))this.status=this.running?'saving':'pending';this.emit();
 }
 receive(snapshot:DocumentSnapshot):boolean{
  if(this.status!=='saved'||snapshot.version<=this.base.version)return false;
  this.base=snapshot;this.draft=snapshot.document;this.emit();return true;
 }
 async flush():Promise<void>{
  if(this.running||this.status==='conflict'||this.status==='invalid')return;
  if(!this.pending){
   const operations=diffDocument(this.base.document,this.draft);
   if(!operations.length){this.status='saved';this.emit();return;}
   this.pending={document:this.draft,request:{baseVersion:this.base.version,operationId:crypto.randomUUID(),...documentChanges(this.base.document,this.draft),operations}};
  }
  const pending=this.pending;this.running=true;this.status='saving';this.emit();
  try{
   const result=await this.send(pending.request);
   if((result.updated||result.reason==='duplicate')&&result.document&&result.version){
    // The server's accepted document includes independent edits since our original base.
    // Replay only keystrokes made AFTER this request; never rebase a rejected request.
    const buffered=diffDocument(pending.document,this.draft);
    const local=documentChanges(pending.document,this.draft),remote=documentChanges(pending.document,result.document);
    const changed=new Set(remote.changedIds),ancestors=new Set(remote.ancestorIds);
    if(local.changedIds.some(id=>changed.has(id)||ancestors.has(id))||local.ancestorIds.some(id=>changed.has(id))){
     this.status='conflict';this.detail='Another edit overlaps changes you typed while saving. Your draft is preserved.';return;
    }
    this.draft=buffered.length?applyDocumentOperations(result.document,buffered):result.document;
    this.base={...this.base,version:result.version,document:result.document};this.pending=null;
    this.status=buffered.length?'pending':'saved';this.detail='';
   }else{
    this.status=!result.updated&&result.reason==='invalid'?'invalid':'conflict';
    this.detail=!result.updated?result.detail??'Another edit overlaps your changes. Your draft is preserved.':'Could not confirm the saved document.';
   }
  }catch(error){this.status='offline';this.detail=error instanceof Error?error.message:'Could not save. Your draft is preserved.';}
  finally{this.running=false;this.emit();}
 }
}
