import type {NativeUploadAdvisoryStore} from './file-upload-runtime-contracts.ts';
/** Native controls use an empty message for an available trusted attachment adapter. */
export function nativeUploadAdvisory(store:NativeUploadAdvisoryStore|null|undefined,valueName:string):string {
 return typeof store?.attachmentUnavailable==='function' ? store.attachmentUnavailable(valueName) ?? '' : 'File uploads are unavailable.';
}
