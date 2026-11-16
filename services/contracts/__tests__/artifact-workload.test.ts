/** Configuration is explicit and the workload wire accepts no asserted authorization scope. */
import {it,expect} from 'vitest';
import {artifactWorkloadOperationJson,parseServiceAudiences,isWorkloadBinding,isArtifactWorkloadOperation} from '../src';
it('requires per-service trust and a fixed credentialed callback with no URL credential',()=>{
 const service={id:'worker',origin:'https://worker.example',introspection_secret_sha256:'a'.repeat(64),artifact_workloads:{authorization_url:'https://worker.example/authorize',authorization_secret:'callback-secret-test'}};
 expect(parseServiceAudiences(JSON.stringify([service]))[0].artifactWorkloads).toEqual({authorizationUrl:'https://worker.example/authorize',authorizationSecret:'callback-secret-test'});
 for(const authorization_url of ['file:///tmp/callback','https://user:secret@worker.example/authorize','https://worker.example/authorize?secret=value','https://worker.example/authorize#secret'])expect(()=>parseServiceAudiences(JSON.stringify([{...service,artifact_workloads:{...service.artifact_workloads,authorization_url}}]))).toThrow();
 expect(()=>parseServiceAudiences(JSON.stringify([{...service,introspection_secret_sha256:undefined}]))).toThrow();
 expect(()=>parseServiceAudiences(JSON.stringify([{...service,artifact_workloads:{...service.artifact_workloads,scope:'all'}}]))).toThrow();
});
it('bounds principals and operations and refuses extra fields',()=>{
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:'group',executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 expect(isWorkloadBinding(principal)).toBe(true);expect(isWorkloadBinding({...principal,epoch:'1'})).toBe(false);expect(isWorkloadBinding({...principal,role:'editor'})).toBe(false);
 const operation={kind:'artifact-create',title:'Report',html:'<p>Report</p>'};expect(isArtifactWorkloadOperation(operation)).toBe(true);
 for(const extra of [{visibility:'public'},{bundle:{}},{parent_id:'folder'},{dataset:{}}])expect(isArtifactWorkloadOperation({...operation,...extra})).toBe(false);
 expect(isArtifactWorkloadOperation({...operation,html:'x'.repeat(210000)})).toBe(false);
});

it('requires the exact host observer operation and canonical digest order',()=>{
 const operation={kind:'artifact-outputs' as const,credential:'q'.repeat(43),after:null};
 expect(isArtifactWorkloadOperation(operation)).toBe(true);
 expect(artifactWorkloadOperationJson(operation)).toBe(JSON.stringify(operation));
 expect(isArtifactWorkloadOperation({...operation,after:'A_z-9'})).toBe(true);
 for(const credential of ['', 'q'.repeat(31),'q'.repeat(129),'q'.repeat(32)+'?'])expect(isArtifactWorkloadOperation({...operation,credential})).toBe(false);
 for(const after of ['', 'x'.repeat(129), 'a/b', 1])expect(isArtifactWorkloadOperation({...operation,after})).toBe(false);
 for(const value of [{kind:operation.kind,credential:operation.credential},{...operation,writeArtifactIds:[]},{...operation,credential:null}])expect(isArtifactWorkloadOperation(value)).toBe(false);
});
