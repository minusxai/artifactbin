import type {SourceRelationshipState} from '@/lib/html-runtime/source-relationship-contract';
/** A short collapsed summary; full evidence remains available in existing controls. */
export interface LocalSourceStatus {summary:string;details:string}
export function localSourceStatus(state:SourceRelationshipState):LocalSourceStatus {
 const labels:Record<SourceRelationshipState,LocalSourceStatus>={
 match:{summary:'Source matches',details:'Source matches the saved remote.'},
 behind:{summary:'Remote updated',details:'Remote source is newer. Local file preserved.'},
 'local-edits':{summary:'Local edits',details:'Local source has edits. Publish changes explicitly.'},
 diverged:{summary:'Both changed',details:'Local and remote source changed. Review both copies.'},
 converged:{summary:'Copies match',details:'Local and remote source match a newer revision.'},
 'unknown-base':{summary:'Cannot compare',details:'No verified common source base.'},
 'local-unverified':{summary:'File not checked',details:'Current file bytes have not been verified.'},
 'network-unknown':{summary:'Remote unavailable',details:'Current remote source is unavailable.'},
 };return labels[state];
}
