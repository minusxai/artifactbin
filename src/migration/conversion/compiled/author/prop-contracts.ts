/** The archived component mount ABI transfers bounded JSON or a top-level
 * declared page binding. It never evaluates a prop expression as JavaScript. */
export interface AdmittedAuthorProps {
  readonly bindings: readonly string[];
}
export type AdmitAuthorProps = (attributes: unknown) => AdmittedAuthorProps;
