import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/kit/tabs';

// The active tab's indicator is the ONE dash of colour a tab strip carries, and
// it belongs to the theme: modernist's red, organic's terracotta. It used to be
// hard-wired to `bg-foreground` (ink), so no theme could put its accent on a
// tab — the kit painted a black underline on every document, whatever the
// palette said. The indicator now reads the `primary` token like every other
// accented kit element (button, badge, progress).

function renderLineTabs() {
  return render(
    <Tabs defaultValue="a">
      <TabsList variant="line" aria-label="sections">
        <TabsTrigger value="a" aria-label="tab a">A</TabsTrigger>
        <TabsTrigger value="b" aria-label="tab b">B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">first</TabsContent>
      <TabsContent value="b">second</TabsContent>
    </Tabs>,
  );
}

describe('kit Tabs — the indicator honours the theme', () => {
  it('the line-variant indicator is painted with the primary token, never the ink colour', () => {
    renderLineTabs();
    const active = document.querySelector('[data-slot="tabs-trigger"][data-state="active"]')!;
    expect(active).toBeTruthy();
    expect(active.className).toContain('after:bg-primary');
    expect(active.className).not.toContain('after:bg-foreground');
  });

  it('the indicator is shown only on the ACTIVE trigger of a line list', () => {
    renderLineTabs();
    const triggers = [...document.querySelectorAll('[data-slot="tabs-trigger"]')];
    expect(triggers).toHaveLength(2);
    for (const t of triggers) {
      expect(t.className).toContain('group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100');
    }
  });
});
