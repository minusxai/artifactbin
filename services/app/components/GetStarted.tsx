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
   <p className="mt-2 text-sm text-muted">Install the verified CLI in your terminal, then connect your account. The installer checks the release checksum; no Node or package manager is needed.</p>
   <CopyBlock text={`curl -fsSL ${origin||'https://artifactbin.dev'}/chat/install.sh | sh`} label="Copy the CLI install command" />
   <CopyBlock text={`afbin setup${origin?` --server ${origin}`:''}`} label="Copy the setup command" />
   <p className="mt-3 text-sm text-muted">Your browser opens for approval. Setup detects Claude Code, Codex, pi and OpenCode and lets you choose which local skills to install. Deselect any you do not want updated.</p>
   <p className="mt-3 text-sm text-muted">Then ask your agent to create a document. It can validate and compare files locally, and publish with <code>afbin push</code>.</p>
   <div className="mt-3 flex flex-wrap gap-4 font-mono text-xs">
    <a href="/docs-human" className="text-accent hover:underline">How it works →</a>
   </div>
  </div>
 </section>;
}
