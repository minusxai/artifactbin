import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createClient,
  createLocalStore,
  gql,
} from "../../../src/apollo/client.ts";
import { createCompiledPeople } from "../../../src/migration/conversion/compiled/person-runtime.ts";
const turn = () => new Promise<void>((r) => setImmediate(r));
test("canonical person watches discard delayed revoked generations and reconnect with fresh authorization", async () => {
  const pending: ((value: any) => void)[] = [],
    listeners = new Set<() => void>(),
    snapshots: any[] = [];
  const client = createClient({
    backends: ["legacyData"],
    state: createLocalStore({}),
    remote: {
      online: () => true,
      subscribe(f) {
        listeners.add(f);
        return () => listeners.delete(f);
      },
      execute() {
        return new Promise((resolve) => pending.push(resolve));
      },
    },
  });
  const document = gql`
    query Person($valueName: String!, $userId: String!) {
      legacyData {
        person(valueName: $valueName, userId: $userId) {
          name
          handle
          image
        }
      }
    }
  `;
  const people = createCompiledPeople(
    [{ valueName: "owner", backendNamespace: "legacyData" }],
    {
      watch(binding, userId, next, error) {
        const subscription = client
          .watchQuery({
            query: document,
            variables: { valueName: binding.valueName, userId },
          })
          .subscribe((result) => {
            if (result.errors?.length) error();
            else if ((result.data.legacyData as any)?.person !== undefined)
              next((result.data.legacyData as any).person);
          });
        return () => subscription.unsubscribe();
      },
      changed(v) {
        snapshots.push(v);
      },
    },
  );
  const invalidate = () => {
    for (const f of [...listeners]) f();
  };
  const reply = (name: string) => ({
    data: { legacyData: { person: { name, handle: null, image: null } } },
  });
  people.update({ owner: "usr_first" });
  await turn();
  invalidate();
  pending[0]!(reply("Stale before denial"));
  await turn();
  assert.equal(pending.length, 2);
  pending[1]!({
    data: { legacyData: null },
    errors: [{ message: "Forbidden" }],
  });
  await turn();
  assert.deepEqual(snapshots.at(-1), {});
  invalidate();
  await turn();
  pending[2]!(reply("Fresh after reconnect"));
  await turn();
  assert.equal(snapshots.at(-1).usr_first.name, "Fresh after reconnect");
  invalidate();
  await turn();
  people.update({ owner: "usr_second" });
  await turn();
  pending[3]!(reply("Late former selection"));
  pending[4]!(reply("Second"));
  await turn();
  assert.equal(snapshots.at(-1).usr_first, undefined);
  assert.equal(snapshots.at(-1).usr_second.name, "Second");
  invalidate();
  await turn();
  people.dispose();
  pending[5]!(reply("Late after disposal"));
  await turn();
  assert.deepEqual(snapshots.at(-1), {});
  client.dispose();
});
