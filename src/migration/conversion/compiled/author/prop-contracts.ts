/** The archived component mount ABI transfers bounded JSON or a top-level
 * declared page binding. It never evaluates a prop expression as JavaScript. */
export type AuthorPropJson = null | boolean | number | string | readonly AuthorPropJson[] | {readonly [key:string]:AuthorPropJson};
export interface AdmittedAuthorProps {
  readonly props: Readonly<Record<string,AuthorPropJson>>;
  readonly bindings: Readonly<Record<string,string>>;
  readonly identity?: string;
  readonly className?: string;
}
export interface AdmittedAuthorMountProps extends AdmittedAuthorProps {
  readonly identity: string;
  readonly component: string;
}
export type AdmitAuthorProps = (attributes: unknown) => AdmittedAuthorProps;
