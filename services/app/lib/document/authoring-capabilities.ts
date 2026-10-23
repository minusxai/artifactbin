/** Versioned native discovery. Reading this document does not initialize services. */
export interface AuthoringCapabilities {
 /** Discovery document schema version; not an installed skill release number. */
 version:1;
 reference:'ref:<id>';
 page:{format:'html';create:{method:'POST';path:'/api/artifacts'};update:{method:'PUT';path:'/api/artifacts/{id}';required:readonly ['html','expectedVersion','expectedState']}};
 graphql:{method:'POST';path:'/api/artifacts/{id}/graphql';schema:{method:'GET';path:'/api/artifacts/{id}/graphql'}};
 dataset:{createField:'dataset';linkRel:'af-dataset';namespaceAttribute:'data-af-name';modes:readonly ['live','pinned']};
 skill:{name:'artifactbin';archive:'/skills/artifactbin.zip';guide:'/llms.txt'};
}
export const authoringCapabilities:AuthoringCapabilities={
 version:1,
 reference:'ref:<id>',
 page:{format:'html',create:{method:'POST',path:'/api/artifacts'},update:{method:'PUT',path:'/api/artifacts/{id}',required:['html','expectedVersion','expectedState']}},
 graphql:{method:'POST',path:'/api/artifacts/{id}/graphql',schema:{method:'GET',path:'/api/artifacts/{id}/graphql'}},
 dataset:{createField:'dataset',linkRel:'af-dataset',namespaceAttribute:'data-af-name',modes:['live','pinned']},
 skill:{name:'artifactbin',archive:'/skills/artifactbin.zip',guide:'/llms.txt'},
};
