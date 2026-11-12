/** Structured SQL/link refusal, shared by the supported dataset doors. */
export class DatasetAccessError extends Error {
  readonly extensions: {code: string};
  constructor(message: string, options: {extensions: {code: string}}) {
    super(message);
    this.name = 'DatasetAccessError';
    this.extensions = options.extensions;
  }
}
