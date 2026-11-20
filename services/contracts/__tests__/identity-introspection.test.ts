/**
 * THE INTROSPECTION ANSWER'S PRINCIPAL (./src/identity-service `IdentityIntrospectResponse`): every active answer names
 * what the token acts as. A person's answer has `user_id` set and no group; a group's (`GROUP_SIGN_IN_RULE`) has the
 * group and its level, `issued_by` who issued its sign-in, and `user_id` null, the only answer where it is.
 */
import {expect,expectTypeOf,it} from 'vitest';
import {IDENTITY_VIEWS, type IdentityIntrospectResponse, type IdentityPrincipalGroupRole, type IdentityPrincipalKind} from '@artifactbin/contracts/identity-service';

type Active = Extract<IdentityIntrospectResponse, {active: true}>;
type Person = Extract<Active, {principal_kind: 'user'}>;
type Group = Extract<Active, {principal_kind: 'group'}>;

it('an active answer carries the principal: a person with a user id, or a group at a level with none', () => {
  expectTypeOf<Active['principal_kind']>().toEqualTypeOf<IdentityPrincipalKind>();
  expectTypeOf<IdentityPrincipalKind>().toEqualTypeOf<'user' | 'group'>();
  expectTypeOf<Active['user_id']>().toEqualTypeOf<string | null>();
  expectTypeOf<Person['user_id']>().toEqualTypeOf<string>();
  expectTypeOf<Person['group_id']>().toEqualTypeOf<null>();
  expectTypeOf<Person['issued_by']>().toEqualTypeOf<string | null>();
  expectTypeOf<Group['user_id']>().toEqualTypeOf<null>();
  expectTypeOf<Group['group_id']>().toEqualTypeOf<string>();
  expectTypeOf<Group['group_role']>().toEqualTypeOf<IdentityPrincipalGroupRole>();
  expectTypeOf<Group['issued_by']>().toEqualTypeOf<string>();
  // Null on a group's sign-in; on a group's exchanged service token, the group sign-in it was exchanged from.
  expectTypeOf<Group['parent']>().toEqualTypeOf<{kind: 'token'; id: string} | null>();
  expectTypeOf<IdentityPrincipalGroupRole>().toEqualTypeOf<'member' | 'editor'>();
  expectTypeOf<Extract<IdentityIntrospectResponse, {active: false}>>().toEqualTypeOf<{active: false}>();
  // Branching on the kind narrows `user_id` to the person.
  const personOf = (answer: IdentityIntrospectResponse) => answer.active && answer.principal_kind === 'user' ? answer.user_id : null;
  expect(personOf({active: false})).toBe(null);
});

it('the tokens view keeps every column readers know in place and appends the principal columns after its rule columns', () => {
  expect(IDENTITY_VIEWS.tokens.slice(0, 13)).toEqual(['id', 'name', 'user_id', 'client_harness', 'audience', 'scope', 'request_authority', 'created_at', 'deleted_at', 'expires_at', 'last_used_at', 'scopes', 'live']);
  expect(IDENTITY_VIEWS.tokens.slice(13)).toEqual(['group_id', 'group_role', 'issued_by', 'grant_id']);
});
