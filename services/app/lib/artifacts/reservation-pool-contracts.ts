/** The batch API returns exactly 100 unique slots, in ordinal order. */
export interface ArtifactReservationCandidate {id:string;ordinal:number}
export interface ArtifactReservationPoolPorts {
 generate():string;
 /** Atomically reserve candidates not occupied by artifacts or any identity registry row. */
 insert(candidates:readonly ArtifactReservationCandidate[]):Promise<readonly ArtifactReservationCandidate[]>;
}
