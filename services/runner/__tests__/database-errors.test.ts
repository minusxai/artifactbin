import {describe,expect,it} from 'vitest';
import {describeDatabaseError,TLS_NAME_MISMATCH,TLS_UNSUPPORTED,TLS_UNTRUSTED} from '../src/database-errors.mjs';

/** A Node TLS refusal as postgres.js passes it on, and as mysql2 does once it overwrites the code. */
const node=(code:string,message:string,extra:Record<string,unknown>={})=>Object.assign(Error(message),{code,...extra});
const mysql2=(code:string,message:string,extra:Record<string,unknown>={})=>node('HANDSHAKE_SSL_ERROR',message,{...extra,original:code});

describe('caps.db error descriptions',()=>{
 it('names a server without TLS, for postgres.js (its SSLRequest answered N) and mysql2',()=>{
  expect(describeDatabaseError(Object.assign(node('ECONNRESET','read ECONNRESET'),{tlsUnsupported:true}))).toBe(TLS_UNSUPPORTED);
  expect(describeDatabaseError(node('HANDSHAKE_NO_SSL_SUPPORT','Server does not support secure connection',{fatal:true}))).toBe(TLS_UNSUPPORTED);
  expect(TLS_UNSUPPORTED).toBe('tls_unsupported: the database server does not offer TLS; enable TLS on the server');
 });
 it.each([
  ['SELF_SIGNED_CERT_IN_CHAIN','self-signed certificate in certificate chain'],
  ['SELF_SIGNED_CERT_IN_CHAIN','self signed certificate in certificate chain'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY','unable to get local issuer certificate'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT','self-signed certificate'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT','self signed certificate'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE','unable to verify the first certificate'],
 ])('says to add the provider CA for %s (%s), by Node code and by mysql2 reason',(code,message)=>{
  expect(describeDatabaseError(node(code,message))).toBe(TLS_UNTRUSTED);
  expect(describeDatabaseError(mysql2(code,message))).toBe(TLS_UNTRUSTED);
  expect(TLS_UNTRUSTED).toBe('tls_untrusted_certificate: add your provider\'s CA certificate to the connection (RDS, Cloud SQL and Supabase need one)');
 });
 it('names a certificate for another host, by Node code and by the host and certificate mysql2 keeps',()=>{
  expect(describeDatabaseError(node('ERR_TLS_CERT_ALTNAME_INVALID','Hostname/IP does not match certificate\'s altnames'))).toBe(TLS_NAME_MISMATCH);
  expect(describeDatabaseError(mysql2('ERR_TLS_CERT_ALTNAME_INVALID','Hostname/IP does not match',{reason:'Host: wrong.example.com. is not in the cert\'s altnames',cert:{subject:{}}}))).toBe(TLS_NAME_MISMATCH);
  expect(TLS_NAME_MISMATCH).toMatch(/^tls_name_mismatch: /);
 });
 it('keeps the existing codes for everything else',()=>{
  expect(describeDatabaseError(Object.assign(Error('tunnel_refused'),{code:'tunnel_refused',tunnel:true}))).toBe('tunnel_refused');
  // A tunnel refusal is its own code even on a postgres socket whose server said N.
  expect(describeDatabaseError(Object.assign(Error('tunnel_limit'),{code:'tunnel_limit',tunnel:true,tlsUnsupported:true}))).toBe('tunnel_limit');
  expect(describeDatabaseError(Object.assign(Error('permission denied for table orders'),{name:'PostgresError',code:'42501'}))).toBe('database_error: 42501 permission denied for table orders');
  expect(describeDatabaseError(Object.assign(Error('x'),{sqlState:'28000',sqlMessage:'Access denied'}))).toBe('database_error: 28000 Access denied');
  expect(describeDatabaseError(node('ECONNRESET','read ECONNRESET'))).toBe('database_error: ECONNRESET');
  expect(describeDatabaseError(node('CERT_HAS_EXPIRED','certificate has expired'))).toBe('database_error: CERT_HAS_EXPIRED');
  expect(describeDatabaseError(mysql2('CERT_HAS_EXPIRED','certificate has expired'))).toBe('database_error: HANDSHAKE_SSL_ERROR certificate has expired');
  expect(describeDatabaseError(Error('boom'))).toBe('database_error: boom');
  expect(describeDatabaseError(undefined)).toBe('database_error: failed');
 });
 it('removes the password and keeps one bounded line',()=>{
  expect(describeDatabaseError(Object.assign(Error('password "s3cret" was rejected\nsecond line'),{name:'PostgresError',code:'28P01'}),['s3cret'])).toBe('database_error: 28P01 password "[redacted]" was rejected');
  expect(describeDatabaseError(Error('x'.repeat(1000))).length).toBe(300);
 });
});
