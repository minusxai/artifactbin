import { describe, expect, it } from 'vitest';
import { commentAccess } from '../comment-access';

describe('reader comment admission', () => {
  it('separates admitted guest and account readers from writers', () => {
    expect(commentAccess('viewer', false, false)).toEqual({ canReadComments: true, canCreateComment: false });
    expect(commentAccess('viewer', true, false)).toEqual({ canReadComments: true, canCreateComment: false });
    expect(commentAccess('commenter', true, false)).toEqual({ canReadComments: true, canCreateComment: true });
    expect(commentAccess('none', false, false)).toEqual({ canReadComments: false, canCreateComment: false });
    expect(commentAccess('owner', true, true)).toEqual({ canReadComments: true, canCreateComment: false });
    expect(commentAccess('commenter', false, false).canCreateComment).toBe(false);
  });
});
