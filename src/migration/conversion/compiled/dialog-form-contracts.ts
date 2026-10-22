import type { CompiledMutationScalar } from "./dataset-mutations-contracts.ts";
export interface AdmittedDialogMutationForm {
 name:string;
 args:Readonly<Record<string,CompiledMutationScalar>>|undefined;
 references:readonly string[];
 requiresViewer:boolean;
}
/** The receipt comes from the existing durable registered-mutation adapter. */
export interface CompiledDialogFormPorts {
 unavailable(): string | null;
 authorizationContext(): string | null;
 unknown(): boolean;
 validate(): boolean;
 args(): Readonly<Record<string, CompiledMutationScalar>> | undefined;
 mutate(args: Readonly<Record<string, CompiledMutationScalar>> | undefined): Promise<unknown>;
 /** Existing durable intent only: never a new mutation or a re-read of the form. */
 reconcile(): Promise<unknown>;
 busy(value: boolean): void;
 close(): void;
}
export interface CompiledDialogFormState {
 busy: boolean;
 error: string | null;
 unavailable: string | null;
 unknown: boolean;
 canReconcile: boolean;
}
export interface CompiledDialogForm {
 state(): CompiledDialogFormState;
 submit(): Promise<void>;
 reconcile(): Promise<void>;
 refresh(): void;
 subscribe(listener: () => void): () => void;
 /** Retires UI ownership, never claims to cancel a dispatched durable write. */
 dispose(): void;
}
