/* @jsxImportSource solid-js */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../kit/tabs';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';

describe('tabs with server owned static panels', () => {
  it('keeps an inactive panel mounted through tab changes', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <IslandProvider value={fakeIsland()}><Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one" forceMount><p id="first">First</p></TabsContent><TabsContent value="two" forceMount><p id="second">Second</p></TabsContent></Tabs></IslandProvider>, host);
    const second = host.querySelector('#second');
    expect(second).not.toBeNull();
    expect(second?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true);
    host.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click();
    expect(host.querySelector('#second')).toBe(second);
    expect(second?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false);
    dispose(); host.remove();
  });
});
