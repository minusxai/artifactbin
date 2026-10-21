import { gql } from '@afbin/apollo';

// Shared notes kept in a Postgres table, not in the store. A lambda can't open
// a connection of its own: it reaches the database only through operations an
// operator connected to this page under a resource name (references/backend.md,
// "Databases and APIs"). Here the operator configured a resource `demo-db` with
// two operations on the table `pagegi_demo.notes(tenant, id, text, created_at)`:
//
//   listNotes   SELECT id,text FROM pagegi_demo.notes WHERE tenant=$1 ORDER BY created_at,id
//               params: tenant
//   addNote     INSERT INTO pagegi_demo.notes(tenant,id,text) VALUES($1,$2,$3)
//               ON CONFLICT (tenant,id) DO NOTHING RETURNING id,text
//               params: tenant, input.id, input.text
//
// `tenant` is bound by the platform to the ID of the page making the call, so
// each page sees only its own notes and the lambda can't name another page's.
// The lambda sends only `input`: the SQL, the connection and the secrets are
// the operator's. Viewers who aren't signed in can't reach the database at all,
// so both fields need a signed-in viewer, and the page asks `viewer` first to
// know whether to show them the form or a hint.

export const typeDefs = gql`
  type Note { id: ID!  text: String! }
  type Query {
    viewer: String
    list: [Note!]! @auth(signedIn: true)
  }
  type Mutation { add(text: String!): Note! @auth(signedIn: true) }
`;

type Note = { id: string; text: string };

export default {
  Query: {
    // The signed-in viewer, or null: `principal` is verified by the platform.
    viewer(_args, principal) {
      return principal.subject;
    },
    async list(_args, _principal, caps): Promise<Note[]> {
      return caps.invoke({ resource: 'demo-db', operation: 'listNotes', input: null });
    },
  },
  Mutation: {
    async add({ text }, _principal, caps): Promise<Note> {
      // Validate before the database does: a thrown error settles the field as
      // "unknown" with the code backend_rejected, so the page checks the same
      // rule first and shows the viewer its own message.
      const trimmed = text.trim();
      if (trimmed.length < 1 || trimmed.length > 500) throw new Error('A note is 1 to 500 characters');
      // The lambda chooses the ID, so the operation's ON CONFLICT DO NOTHING
      // keeps a repeated insert from making a second row.
      const [note] = await caps.invoke({
        resource: 'demo-db',
        operation: 'addNote',
        input: { id: crypto.randomUUID(), text: trimmed },
      });
      if (!note) throw new Error('The note was not saved');
      return note;
    },
  },
};
