/* @jsxImportSource solid-js */
// A Solid component the island build's transform test (scripts/__tests__/build-islands-solid.test.mjs) compiles.
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';

export function Counter(props: { label: string }) {
  const [count, setCount] = createSignal(0);
  const [state] = createStore({ unit: 'clicks' });
  return <button type="button" onClick={() => setCount(count() + 1)}>{props.label}: {count()} {state.unit}</button>;
}

export { render };
