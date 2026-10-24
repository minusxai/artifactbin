/** Reviewed immutable source evidence; changing the target proposal never rewrites it. */
export interface NativeSourceCaptureReuse {
 baselineInputPath:string;
 candidateInputPath:string;
 baselineInputSha256:string;
 candidateInputSha256:string;
 baselineProofSha256:string;
 baselineCapturesSha256:string;
 /** Extra target-only behavior checks, tied to the independently recorded target probe. */
 additionalCandidateAssertions?:{probeSha256:string;ids:readonly string[]};
}
