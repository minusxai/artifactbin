/** Installed author toolbox wire/storage contracts. Metadata is an observed baseline, never authority. */
export interface AuthorBaseline {
 kind:'author-baseline'; schema:1; server:string; id:string; version:number; state:string; format:string;
 sourceFile:string; pair:string; historical:boolean;
 root:string; entryPath:string; dependencyReceipts:ReadonlyArray<{path:string;kind:'asset'|'dataset';id:string;revision:string;state?:string;sha256?:string}>;
 retainedBackends:ReadonlyArray<{name:string;href:string}>;
 /** The saved source's hash (read --output refreshes an unchanged file in place) and the sharing revision seen with it. */
 sha256?:string; sharingRevision?:number;
}
export interface AuthorJournal {
 kind:'author-request'; schema:1; server:string; method:'POST'|'PUT'|'PATCH'; path:string; key:string;
 body:Record<string,unknown>; operation:'publish'|'comment'; source?:{file:string;sha256:string;root:string;entryPath:string;output?:string};
 baseline?:AuthorBaseline;
}
export interface AuthorResult {ok:boolean;code:string;recovery?:string;[key:string]:unknown}
export interface CommentCheckpoint {kind:'comment-checkpoint';schema:1;server:string;artifact:string;stream:'comments';cursor:string;eventIds:string[]}

/** Check diagnostics stay at the top level on success and refusal. */
export interface AuthorCheckResult {
 smokePassed:boolean; checks:ReadonlyArray<Record<string,unknown>>; unverified:ReadonlyArray<string>; note:string;
 /** A passing hosted check's Reply block facts (toolbox-check-reply.mjs replyFacts). */
 reply?:{id:string;link:string;builtWith?:string;permissions:ReadonlyArray<{id:string;name:string;lines:string[]}>};
 slideLinks?:string[];
 /** Linked datasets the page never read on any viewport, load or steps (a failed check). */
 unreadDatasets?:ReadonlyArray<{id:string;name:string}>;
}
