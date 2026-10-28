#!/usr/bin/env node
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,access,chmod,chown} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const loginKeys=['EMAIL__RESEND_API_KEY','EMAIL__FROM','EMAIL__SMTP_HOST','EMAIL__SMTP_PORT','EMAIL__SMTP_SECURE','EMAIL__SMTP_USER','EMAIL__SMTP_PASSWORD','AUTH__GOOGLE_CLIENT_ID','AUTH__GOOGLE_CLIENT_SECRET','AUTH__OIDC_PROVIDER_ID','AUTH__OIDC_CLIENT_ID','AUTH__OIDC_CLIENT_SECRET','AUTH__OIDC_DISCOVERY_URL','AUTH__OIDC_AUTHORIZATION_URL','AUTH__OIDC_TOKEN_URL','AUTH__OIDC_USERINFO_URL'];
export function validateInputs(input){
 const names=['APP_HOSTNAME','PAGES_HOSTNAME','OWNER_EMAIL','ALLOWED_EMAIL_PATTERNS','ACME_EMAIL','DNS_MODULE'];
 for(const name of [...names,...loginKeys]){const value=input[name];if(names.includes(name)&&!value)throw Error(`Missing ${name}`);if(value&&/[\r\n\x00]/.test(value))throw Error(`Invalid ${name}: one line required`);}
 const hostname=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
 if(!hostname.test(input.APP_HOSTNAME)||!hostname.test(input.PAGES_HOSTNAME)||!input.PAGES_HOSTNAME.endsWith(`.${input.APP_HOSTNAME}`))throw Error('Use public hostnames; pages must be a subdomain of the application hostname');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.OWNER_EMAIL)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.ACME_EMAIL))throw Error('Owner and ACME email required');
 if(!/^github\.com\/caddy-dns\/[a-z0-9-]+@v\d+\.\d+\.\d+$/.test(input.DNS_MODULE))throw Error('DNS_MODULE must name an explicitly version-pinned caddy-dns module');
 const complete=keys=>keys.every(key=>input[key]);
 const smtpKeys=loginKeys.filter(key=>key.startsWith('EMAIL__SMTP_'));
 const hasSmtp=smtpKeys.some(key=>input[key]);
 if(hasSmtp){
  if(!input.EMAIL__SMTP_HOST||!input.EMAIL__FROM)throw Error('SMTP requires EMAIL__SMTP_HOST and EMAIL__FROM');
  if(!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])$/i.test(input.EMAIL__SMTP_HOST))throw Error('Invalid EMAIL__SMTP_HOST');
  if(input.EMAIL__SMTP_PORT&&(!/^\d+$/.test(input.EMAIL__SMTP_PORT)||Number(input.EMAIL__SMTP_PORT)<1||Number(input.EMAIL__SMTP_PORT)>65535))throw Error('Invalid EMAIL__SMTP_PORT');
  if(input.EMAIL__SMTP_SECURE&&!['true','false'].includes(input.EMAIL__SMTP_SECURE))throw Error('Invalid EMAIL__SMTP_SECURE');
  if(Boolean(input.EMAIL__SMTP_USER)!==Boolean(input.EMAIL__SMTP_PASSWORD))throw Error('SMTP requires both EMAIL__SMTP_USER and EMAIL__SMTP_PASSWORD');
  if(input.EMAIL__RESEND_API_KEY)throw Error('Configure either SMTP or Resend, not both');
 }
 const email=complete(['EMAIL__RESEND_API_KEY','EMAIL__FROM'])||hasSmtp;const google=complete(['AUTH__GOOGLE_CLIENT_ID','AUTH__GOOGLE_CLIENT_SECRET']);
 const oidc=complete(['AUTH__OIDC_PROVIDER_ID','AUTH__OIDC_CLIENT_ID','AUTH__OIDC_CLIENT_SECRET'])&&(input.AUTH__OIDC_DISCOVERY_URL||complete(['AUTH__OIDC_AUTHORIZATION_URL','AUTH__OIDC_TOKEN_URL','AUTH__OIDC_USERINFO_URL']));
 if(!email&&!google&&!oidc)throw Error('Configure complete verified SMTP, Resend, Google or OIDC login');
 if(loginKeys.filter(key=>key.startsWith('AUTH__OIDC_')).some(key=>input[key])&&!oidc)throw Error('Incomplete OIDC login configuration');
 if(input.EMAIL__RESEND_API_KEY&&!input.EMAIL__FROM)throw Error('Resend requires EMAIL__FROM');
 for(const keys of [['AUTH__GOOGLE_CLIENT_ID','AUTH__GOOGLE_CLIENT_SECRET']])if(keys.some(key=>input[key])&&!complete(keys))throw Error('Incomplete login configuration');
 return input;
}
export async function initializeCompany(directory,input){
 validateInputs(input);directory=resolve(directory);
 for(const path of ['.env','config/server.env','secrets/postgres-password','secrets/dns.env','Caddyfile','dns-provider.caddy']){try{await access(join(directory,path));throw Error('Deployment already initialized; edit existing configuration without rotating secrets');}catch(error){if(error.code!=='ENOENT')throw error;}}
 const uid=process.getuid?.()||1000,gid=process.getgid?.()||1000;
 const password=randomBytes(32).toString('hex'),secret=randomBytes(32).toString('hex');
 for(const name of ['config','secrets']){await mkdir(join(directory,name),{recursive:true,mode:0o700});await chmod(join(directory,name),0o700);}
 const settings={APP__HOST:'0.0.0.0',APP__PORT:'7445',APP__PUBLIC_BASE_URL:`https://${input.APP_HOSTNAME}`,APP__PAGES_HOST:input.PAGES_HOSTNAME,APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:input.OWNER_EMAIL,AUTH__INVITE_ONLY:'true',AUTH__ALLOWED_EMAIL_PATTERNS:input.ALLOWED_EMAIL_PATTERNS,AUTH__SECRET:secret,DATABASE_URL:`postgres://artifactbin:${password}@postgres:5432/artifactbin`,...Object.fromEntries(loginKeys.filter(key=>input[key]).map(key=>[key,input[key]]))};
 await writeFile(join(directory,'config/server.env'),Object.entries(settings).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{flag:'wx',mode:0o600});
 if(process.getuid?.()===0){await chown(join(directory,'config'),uid,gid);await chown(join(directory,'config/server.env'),uid,gid);}
 await writeFile(join(directory,'secrets/postgres-password'),password+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(directory,'secrets/dns.env'),'# Provider credentials for Caddy ONLY; instance-role Route53 can leave this empty.\n',{flag:'wx',mode:0o600});
 await writeFile(join(directory,'Caddyfile'),`{\n email ${input.ACME_EMAIL}\n}\n${input.APP_HOSTNAME}, ${input.PAGES_HOSTNAME}, *.${input.PAGES_HOSTNAME} {\n import /etc/caddy/dns-provider.caddy\n reverse_proxy app:7445\n}\n`,{flag:'wx',mode:0o600});
 await writeFile(join(directory,'dns-provider.caddy'),'# REQUIRED: replace with your provider TLS configuration (see README).\n',{flag:'wx',mode:0o600});
 await writeFile(join(directory,'.env'),`APP_UID=${uid}\nAPP_GID=${gid}\nDNS_MODULE=${input.DNS_MODULE}\n`,{flag:'wx',mode:0o600});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 initializeCompany(process.argv[2]||process.cwd(),process.env).then(()=>console.log('Initialized private configuration. Configure dns-provider.caddy and secrets/dns.env before starting.')).catch(error=>{console.error(error.message);process.exitCode=1;});
}
