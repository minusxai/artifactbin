import { gql } from '@afbin/apollo';

export const typeDefs = gql`
  type Todo { id: ID!  text: String!  done: Boolean! }
  type Query { list: [Todo!]! }
  type Mutation {
    add(text: String!): Todo!
    toggle(id: ID!): Todo
    remove(id: ID!): Boolean! @auth(role: EDITOR)
  }
`;

type Todo = { id: string; text: string; done: boolean };
type Board = { next: number; todos: Todo[] };

// Read the store, change it, and save it if nobody else saved in between.
// On a conflict, read again and redo the change.
async function change<T>(caps, update: (board: Board) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, version } = await caps.store.get();
    const board: Board = value ?? { next: 1, todos: [] };
    const result = update(board);
    try {
      await caps.store.set(board, { expected: version });
      return result;
    } catch (error) {
      if (error.code !== 'conflict') throw error;
    }
  }
  throw new Error('The list is busy; try again');
}

export default {
  Query: {
    async list(_args, _principal, caps) {
      const { value } = await caps.store.get();
      return value?.todos ?? [];
    },
  },
  Mutation: {
    add({ text }, _principal, caps) {
      return change(caps, (board) => {
        const todo = { id: String(board.next++), text, done: false };
        board.todos.push(todo);
        return todo;
      });
    },
    toggle({ id }, _principal, caps) {
      return change(caps, (board) => {
        const todo = board.todos.find((t) => t.id === id);
        if (todo) todo.done = !todo.done;
        return todo ?? null;
      });
    },
    remove({ id }, _principal, caps) {
      return change(caps, (board) => {
        const before = board.todos.length;
        board.todos = board.todos.filter((t) => t.id !== id);
        return board.todos.length < before;
      });
    },
  },
};
