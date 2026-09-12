'use client';

import {useEffect,useState} from 'react';
import CopyBlock from '@/components/CopyBlock';

/** One installation path. The CLI owns authentication and harness discovery/consent. */
export default function GetStarted({heading=true,frame=true}:{heading?:boolean;frame?:boolean}){
 const [origin,setOrigin]=useState('');
 useEffect(()=>{setOrigin(window.location.origin);},[]);
 return <section aria-label="Get started">
  <div className={frame?'rounded-[6px] border border-edge bg-surface px-4 py-3.5':undefined}>
   {heading&&<h2 className="font-mono text-sm text-fg">Get started with artifactbin</h2>}
   <p className="mt-2 text-sm text-muted">Install the verified CLI in your terminal; afbin connects your account itself the first time you use it. The installer checks the release checksum; no Node or package manager is needed.</p>
   <CopyBlock text={`curl -fsSL ${origin||'https://artifactbin.dev'}/chat/install.sh | sh`} label="Copy the CLI install command" />
   <p className="mt-3 text-sm text-muted">afbin signs you in through your browser the first time it needs the server, and installs local skills for Claude Code, Codex, pi and OpenCode.</p>
   <p className="mt-3 text-sm text-muted">Then ask your agent to create a document. It can validate and compare files locally, and publish with <code>afbin push</code>.</p>
   <div className="mt-3 flex flex-wrap gap-4 font-mono text-xs">
    <a href="/docs-human" className="text-accent hover:underline">How it works →</a>
   </div>
  </div>
 </section>;
}
