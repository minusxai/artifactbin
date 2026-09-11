/** The single published-artifact reference grammar, shared by every surface. */
export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9]{6,12}$/;
export const ARTIFACT_REFERENCE_PATTERN = /^ref:([A-Za-z0-9]{6,12})$/;
/** The trailing title is decoration; only the exact opaque ID identifies the artifact. */
export const ARTIFACT_SEGMENT_PATTERN = /^([A-Za-z0-9]{6,12})(?:-(.*))?$/;
