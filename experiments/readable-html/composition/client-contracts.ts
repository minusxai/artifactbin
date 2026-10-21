export interface ClientProof { observed:number[]; rejected:boolean; queued:number; confirmed:number; history:number; disposed:boolean; }
declare global { interface Window { phaseClientProof:ClientProof; } }
