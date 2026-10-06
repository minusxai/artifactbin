/** An abandoned lazy page still completes its module evaluation after its root is disposed. */
export const page = await new Promise<string>(resolve => setTimeout(() => resolve('loaded'), 25));
