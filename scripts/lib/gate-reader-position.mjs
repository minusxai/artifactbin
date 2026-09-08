/** Reader position is the same content at the same viewport coordinate.
 * scrollY alone misses content-inset jumps and rejects valid compensation.
 */
export const sameReaderPosition=(before,after)=>!!before?.id&&before.id===after?.id&&Number.isFinite(before.top)&&Number.isFinite(after.top)&&Math.abs(before.top-after.top)<5;
