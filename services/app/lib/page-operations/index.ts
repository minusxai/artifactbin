/** Native page GraphQL and isolated backend execution boundary. */
export {composePageSchema,executePageOperation} from './namespaces';
export {createPageOperations,type PageOperationPorts} from './service';
export {compilePageBackend,createBackendCompiler,createBackendInvoker,pageBackendCapability,type CompiledPageBackend,type PageBackendRecord,type PageBackendStore} from './backend';
export {FieldFailed,FieldNotExecuted} from './contracts';
