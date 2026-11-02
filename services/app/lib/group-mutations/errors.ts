export class GroupError extends Error {
 constructor(public code:string,public status=400,public retryAfter?:number){super(code);}
}
