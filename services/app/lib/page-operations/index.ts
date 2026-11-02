/** Native page GraphQL and isolated backend execution boundary. */
export {composePageSchema,executePageOperation,pageOperationKind} from './namespaces';
export {createPageOperations} from './service';
export {compilePageBackend,createBackendInvoker} from './backend';
export {declaresResolverTest} from './execution-policy';
export {FieldFailed} from './contracts';
export {pageBackendOperation,localPageBackendCapability} from './transport';
export {createResolverQuery} from './query';
export { FIELD_ERROR_CODE } from './contracts';
