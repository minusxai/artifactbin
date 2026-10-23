/** Native page GraphQL and isolated backend execution boundary. */
export {composePageSchema,executePageOperation} from './namespaces';
export {createPageOperations} from './service';
export {compilePageBackend,createBackendInvoker} from './backend';
export {FieldFailed} from './contracts';
export {pageBackendOperation,localPageBackendCapability} from './transport';
