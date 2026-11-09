/** Installed author toolbox wire/storage contracts. Local state is an observed baseline, never authority. */
/**
 * The af-authoring marker: the last line of an HTML source, `<!-- af-authoring:BASE64URL(JSON) -->`, and the only
 * local record of the page the file publishes over. Nothing beside the file is written or read.
 */
export interface AuthorMarker {
 server:string; id:string; version:number; state:string;
 /** sha256 of the source without its marker: read --output refreshes a file still unchanged since then in place. */
 sha256:string;
 /** The file's path in its publication root (the page's dependency receipts are relative to that root). */
 entryPath:string;
 /** Read from a saved version: publishing it would replace the newer page, so publish refuses. */
 historical?:true;
 /** The sharing revision seen with this version: a visibility change on update names it. */
 sharingRevision?:number;
}
/** The doc.mjs marker: the first line of a doc file, `<!-- af-doc:BASE64URL(JSON) -->`, stripped before sending. */
export interface DocMarker {
 server:string; id:string; regionId:string; regionKind:string; format:'markdown'|'html'; version:number;
 /** The journal of a write whose outcome is unknown: the next write resumes it, never writing twice. */
 pending?:string;
}
/** What a publish replaces: the marker's (or, with --artifact, the head's) version and state, and the page's
 * dependency receipts as the server recorded them. */
export interface AuthorBaseline {
 id:string; version:number; state:string; sharingRevision?:number;
 dependencyReceipts:ReadonlyArray<{path:string;kind:'asset'|'dataset';id:string;revision:string;state?:string;sha256?:string}>;
 retainedBackends:ReadonlyArray<{name:string;href:string}>;
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
 /** A passing hosted check's reply facts (toolbox-check-reply.mjs replyFacts). */
 reply?:{id:string;link:string;builtWith?:string;permissions:ReadonlyArray<{id:string;name:string;lines:string[]}>};
 slideLinks?:string[];
 /** Linked datasets the page never read on any viewport, load or steps (a failed check). */
 unreadDatasets?:ReadonlyArray<{id:string;name:string}>;
 /** Failed GraphQL fields (toolbox-check-resolvers.mjs): the owner-only detail, or for a guest its code and
  * what the same read-only query gives the owner. Never a secret, token, query or variables. */
 graphqlFailures?:ReadonlyArray<{field:string;message:string;code?:string;detail?:string;guest?:true;ownerDetail?:string;ownerPasses?:true;notReplayed?:true}>;
 /** What only an unset resolver secret blocked (Not tested, not failed): the unfinished step (null outside a
  * step; absent when no step failed), the refused fields and the secrets the owner sets in Resolvers settings. */
 needsSecrets?:ReadonlyArray<{step?:string|null;fields:string[];secrets:string[]}>;
}
