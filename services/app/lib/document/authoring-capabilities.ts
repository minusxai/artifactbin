/** Versioned native discovery. Reading this document does not initialize services. */
export interface AuthoringCapabilities {
 /** Discovery document schema version; not an installed skill release number. */
 version:1;
 reference:'ref:<id>';
 page:{format:'html';create:{method:'POST';path:'/api/artifacts'};update:{method:'PUT';path:'/api/artifacts/{id}';required:readonly ['html','expectedVersion','expectedState']}};
 /** One SQL statement over a page's linked datasets as the reader: `{sql, params?, revision}` and an Idempotency-Key for a write. */
 sql:{method:'POST';path:'/api/artifacts/{id}/sql';body:readonly ['sql','params','revision']};
 dataset:{createField:'dataset';linkRel:'af-dataset';namespaceAttribute:'data-af-name';modes:readonly ['live','pinned']};
 skill:{name:'artifactbin';archive:'/skills/artifactbin.zip';guide:'/llms.txt'};
}
export const authoringCapabilities:AuthoringCapabilities={
 version:1,
 reference:'ref:<id>',
 page:{format:'html',create:{method:'POST',path:'/api/artifacts'},update:{method:'PUT',path:'/api/artifacts/{id}',required:['html','expectedVersion','expectedState']}},
 sql:{method:'POST',path:'/api/artifacts/{id}/sql',body:['sql','params','revision']},
 dataset:{createField:'dataset',linkRel:'af-dataset',namespaceAttribute:'data-af-name',modes:['live','pinned']},
 skill:{name:'artifactbin',archive:'/skills/artifactbin.zip',guide:'/llms.txt'},
};
