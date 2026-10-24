/** Lookup only through an actual linked dataset namespace; omitted identities stay absent. */
export interface NativeBindingPeople {
 namespace:string;
 datasetRef:string;
 mode:"live";
 authority:'linked-dataset-typed-user-v1';
}
export interface NativeAuthDelegation {
 sourceNode:string;
 analysisSha256:string;
 destination:'platform-topbar-sign-in';
 behavior:'platform-sign-in-replaces-embedded-auth';
}
