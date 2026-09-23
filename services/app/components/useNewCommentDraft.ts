import {useCallback, useEffect, useRef, useState} from 'react';
import type {RemoteSessionInfo} from '../../contracts/src/remote';
import {remoteMention} from '../lib/remote-reply';

/** Defaults are selected once per composer opening; any user edit wins over late discovery. */
export function useNewCommentDraft(open: boolean) {
  const [draft, setDraft] = useState('');
  const touched = useRef(false);
  const changeDraft = useCallback((value: string) => {
    touched.current = true;
    setDraft(value);
  }, []);
  useEffect(() => {
    if (!open) { touched.current = false; return; }
    const abort = new AbortController();
    void fetch('/api/remote/sessions', {credentials: 'same-origin', signal: abort.signal})
      .then(response => response.ok ? response.json() : {sessions: []})
      .then((data: {sessions?: RemoteSessionInfo[]}) => {
        if (abort.signal.aborted || touched.current) return;
        const online = (data.sessions ?? []).filter(session => session.online && session.activity !== 'stopped' && session.exitCode === null);
        if (online.length === 1) setDraft(remoteMention(online[0]!));
      })
      .catch(() => { /* Discovery is optional: a comment can always be written manually. */ });
    return () => abort.abort();
  }, [open]);
  return [draft, changeDraft] as const;
}
