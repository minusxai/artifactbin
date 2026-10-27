/** Installed author toolbox wire/storage contracts. Metadata is an observed baseline, never authority. */
export interface AuthorBaseline {
 kind:'author-baseline'; schema:1; server:string; id:string; version:number; state:string; format:string;
 sourceFile:string; pair:string; historical:boolean;
 root:string; entryPath:string; dependencyReceipts:ReadonlyArray<{path:string;kind:'asset'|'dataset';id:string;revision:string;state?:string;sha256?:string}>;
 retainedBackends:ReadonlyArray<{name:string;href:string}>;
}
export interface AuthorJournal {
 kind:'author-request'; schema:1; server:string; method:'POST'|'PUT'|'PATCH'; path:string; key:string;
 body:Record<string,unknown>; operation:'publish'|'comment'; source?:{file:string;sha256:string;root:string;entryPath:string;output?:string};
 baseline?:AuthorBaseline;
}
export interface AuthorResult {ok:boolean;code:string;recovery?:string;[key:string]:unknown}
/** `stream` is 'comments'; checkpoints written before the rename say 'human-comments' and are still read. */
export interface CommentCheckpoint {kind:'comment-checkpoint';schema:1;server:string;artifact:string;stream:'comments'|'human-comments';cursor:string;eventIds:string[]}

/** Check diagnostics stay at the top level on success and refusal; details remains a compatibility alias. */
export interface AuthorCheckResult {
 smokePassed:boolean; checks:ReadonlyArray<Record<string,unknown>>; unverified:ReadonlyArray<string>; note:string;
}
