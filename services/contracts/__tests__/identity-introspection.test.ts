/**
 * THE INTROSPECTION ANSWER'S PRINCIPAL (./src/identity-service `IdentityIntrospectResponse`): every active answer names
 * what the token acts as, and a reader can already branch on a group principal while `user_id` stays a string.
 */
import {expect,expectTypeOf,it} from 'vitest';
import {IDENTITY_VIEWS,type IdentityIntrospectResponse,type IdentityPrincipalGroupRole,type IdentityPrincipalKind} from '@artifactbin/contracts';

type Active = Extract<IdentityIntrospectResponse, {active: true}>;

it('an active answer carries the principal: its kind, the person, and the group fields', () => {
  expectTypeOf<Active['principal_kind']>().toEqualTypeOf<IdentityPrincipalKind>();
  expectTypeOf<IdentityPrincipalKind>().toEqualTypeOf<'user' | 'group'>();
  expectTypeOf<Active['user_id']>().toEqualTypeOf<string>();
  expectTypeOf<Active['group_id']>().toEqualTypeOf<string | null>();
  expectTypeOf<Active['group_role']>().toEqualTypeOf<IdentityPrincipalGroupRole | null>();
  expectTypeOf<IdentityPrincipalGroupRole>().toEqualTypeOf<'member' | 'editor'>();
  expectTypeOf<Active['issued_by']>().toEqualTypeOf<string | null>();
  expectTypeOf<Extract<IdentityIntrospectResponse, {active: false}>>().toEqualTypeOf<{active: false}>();
  // A reader's check for a group principal compiles today.
  const actsAsGroup = (answer: IdentityIntrospectResponse) => answer.active && answer.principal_kind === 'group';
  expect(actsAsGroup({active: false})).toBe(false);
});

it('the tokens view keeps every column readers know in place and appends the principal columns after its rule columns', () => {
  expect(IDENTITY_VIEWS.tokens.slice(0, 13)).toEqual(['id', 'name', 'user_id', 'client_harness', 'audience', 'scope', 'request_authority', 'created_at', 'deleted_at', 'expires_at', 'last_used_at', 'scopes', 'live']);
  expect(IDENTITY_VIEWS.tokens.slice(13)).toEqual(['group_id', 'group_role', 'issued_by', 'grant_id']);
});
