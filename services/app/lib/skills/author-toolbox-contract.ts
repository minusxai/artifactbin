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
/** The syntax a region's text was read in (`--html` or the default); a region's syntax, never an artifact format. */
type RegionSyntax='html'|'markdown';
export interface DocMarker {
 server:string; id:string; regionId:string; regionKind:string; format:RegionSyntax; version:number;
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

/** Check diagnostics stay at the top level on success and refusal. */
export interface AuthorCheckResult {
 smokePassed:boolean; checks:ReadonlyArray<Record<string,unknown>>; unverified:ReadonlyArray<string>; note:string;
 /** A passing hosted check's reply facts (toolbox-check-reply.mjs replyFacts). */
 reply?:{id:string;link:string;builtWith?:string;permissions:ReadonlyArray<{id:string;name:string;lines:string[]}>};
 slideLinks?:string[];
 /** Linked datasets the page never read on any viewport, load or steps (a failed check). */
 unreadDatasets?:ReadonlyArray<{id:string;name:string}>;
 /** Failed calls (toolbox-check-explain.mjs): `sql` or an older page's GraphQL field, with
  * the owner-only detail, or for a guest its code and what the same read gives the owner. Never a secret, token,
  * statement, query or variables. */
 callFailures?:ReadonlyArray<{field:string;kind:'sql'|'graphql';message:string;code?:string;detail?:string;guest?:true;ownerDetail?:string;ownerPasses?:true;notReplayed?:true}>;
}
