export interface LegacySourceOperationNormalization {
 source: string;
 /** Literal source refs remain subject to the ordinary verified dataset catalog. */
 imports: readonly {name:string;legacyRef:string}[];
 operations: readonly {name:string;kind:'Query'|'Mutation';legacyRef:string}[];
}
