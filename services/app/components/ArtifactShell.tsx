'use client';

/**
 * Who this viewer IS to /a/<id>, for the chrome above it.
 *
 * ONE signal, decided on the server (components/ArtifactDocument →
 * lib/viewer's `roleFor`): an owner (an account session, or an anonymous
 * browser holding the agent-session cookie), a named EDITOR
 * (artifact_shares.role — they edit, but never share, move or delete), or a
 * reader. Resolved on the very request that renders this page, so the answer
 * is known before the first paint, this component issues no request of its
 * own, and nothing can contradict itself a round trip later.
 */
import { createContext, useContext } from 'react';
import { canAnnotate, canEdit, canGovern, type ArtifactRole } from '@/lib/share-roles';

const RoleContext = createContext<ArtifactRole>('viewer');

/** This viewer's role — the shell's one signal. Default `viewer`: a surface rendered outside the shell is a reading view. */
export const useArtifactRole = () => useContext(RoleContext);
/*
 * The three capability questions, answered by the SAME lattice predicates the
 * server door uses (lib/share-roles). They were hand-written comparisons once,
 * and the first shell derived "can edit" as "is not a reader" — which handed a
 * commenter the edit button the moment that role existed. A hook that spells
 * out its own rule is a hook that can disagree with the door it guards.
 */
/** The owner's affordances: share, delete, move, dataset reference. */
export const useArtifactOwner = () => canGovern(useArtifactRole());
/** May change the text: the owner or an editor — never a commenter. */
export const useCanEditArtifact = () => canEdit(useArtifactRole());
/** May annotate: the owner, an editor, or a commenter. */
export const useCanAnnotateArtifact = () => canAnnotate(useArtifactRole());

export interface ArtifactShellProps {
  /** This viewer's role on the artifact (decided by the page, server-side). */
  role: ArtifactRole;
  children: React.ReactNode;
}

export default function ArtifactShell({ role, children }: ArtifactShellProps) {
  // Chrome is not the owner's privilege: every page wears the same top bar
  // (components/PageChrome), and the role only decides which ACTIONS it carries.
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}
