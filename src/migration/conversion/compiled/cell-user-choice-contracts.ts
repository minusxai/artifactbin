/** Public routes only. The saved backend owns exact source-column and membership authority. */
export interface CompiledCellUserChoiceBinding { queryName:string; column:string; backendNamespace:string; }
export interface CompiledCellUserChoice { value:string; label:string; }
export interface CompiledCellUserChoicePorts {
 watch(binding:CompiledCellUserChoiceBinding,next:(value:unknown)=>void,error:()=>void):()=>void;
 changed(options:Readonly<Record<string,readonly CompiledCellUserChoice[]>>):void;
}
