import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { StoryRuntimeApp } from '../StoryRuntimeApp';

describe('persisted source ids reach runtime embed targets', () => {
  for (const tag of ['Question', 'Number', 'DataTable']) {
    it(`${tag} preserves its authored id on exactly one DOM target even without loaded data`, () => {
      const parsed = parseJsx(`<${tag} id="node-a" data="$missing" />`);
      if (!parsed.ok) throw new Error(parsed.error);
      const { container } = render(<StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" chrome={false} />);
      expect(container.querySelectorAll('[id="node-a"]')).toHaveLength(1);
    });
  }
});
