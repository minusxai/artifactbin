/** Shared by publishing, the renderer and the number inspector. */
export const NUMBER_AGGS = ['first', 'sum', 'avg', 'min', 'max', 'count'] as const;
export type NumberAgg = typeof NUMBER_AGGS[number];
