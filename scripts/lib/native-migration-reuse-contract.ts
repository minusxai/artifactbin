/** Reviewed immutable source evidence; changing the target proposal never rewrites it. */
export interface NativeSourceCaptureReuse {
 baselineInputPath:string;
 candidateInputPath:string;
 baselineInputSha256:string;
 candidateInputSha256:string;
 baselineProofSha256:string;
 baselineCapturesSha256:string;
}
