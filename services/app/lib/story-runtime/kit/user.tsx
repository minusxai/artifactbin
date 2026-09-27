/** The `user` kit chunk: a person — `<User>`, the face and the handle it is made of — resolved from the island and the store. */
import { useContext } from 'react';
import type { PersonCard } from '@artifactbin/contracts';
import { User } from '@/components/kit/user';
import { UserImage } from '@/components/kit/user-image';
import { UserHandle } from '@/components/kit/user-handle';
import { refName } from '@/lib/story/dataflow';
import { VIEWER_ID } from '@/lib/story/builtins';
import { RuntimeEmbedContext } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

/**
 * A PERSON, LIVE: the authored reference resolved, then carded.
 *
 * Three shapes of `id` reach here, and they are resolved in this order because
 * only the first two are references at all:
 *  - `$_me` — the viewer, off the island (right on the first paint, no query);
 *  - `$name` — a scalar `<Value>`, off the store;
 *  - anything else — already a literal id, including a `$_row.field` the
 *    interpreter substituted inside a `<For>` or a `<Column>`.
 *
 * The PERSON then comes from one map: `state.people`, the same server-computed
 * cards a DataTable cell reads, plus the viewer's own from the island. Nothing
 * here can ask the server about an id, which is the point — an id the server did
 * not already put in front of this viewer stays "Unknown person".
 *
 * One hook for all three person tags, so a face, a handle and the composition
 * of the two can never disagree about who they are showing.
 */
function usePerson(idProp: unknown): { id: string | null; card: PersonCard | null } {
  const ctx = useContext(RuntimeEmbedContext);
  const reference = typeof idProp === 'string' ? refName(idProp) : null;
  const resolved = reference === VIEWER_ID ? ctx.viewer?.id ?? null
    : reference !== null ? ctx.state.values[reference] ?? null
    : idProp ?? null;
  const id = typeof resolved === 'string' ? resolved : null;
  const card = id === null ? null
    : id === ctx.viewer?.id ? ctx.viewer.card ?? ctx.state.people?.[id] ?? null
    : ctx.state.people?.[id] ?? null;
  return { id, card };
}

function UserImageAdapter(props: Record<string, unknown>) {
  const { id, card } = usePerson(props.userId);
  const { userId: _userId, card: _card, ...rest } = props;
  return <UserImage {...rest} userId={id} card={card} />;
}

function UserHandleAdapter(props: Record<string, unknown>) {
  const { id, card } = usePerson(props.userId);
  const { userId: _userId, card: _card, ...rest } = props;
  return <UserHandle {...rest} userId={id} card={card} />;
}

function UserAdapter(props: Record<string, unknown>) {
  const { id, card } = usePerson(props.userId);
  const { userId: _userId, card: _card, ...rest } = props;
  return <User {...rest} userId={id} card={card} />;
}

export const chunk: KitChunk = {
  faces: { User, UserImage, UserHandle },
  live: { User: UserAdapter, UserImage: UserImageAdapter, UserHandle: UserHandleAdapter },
};
