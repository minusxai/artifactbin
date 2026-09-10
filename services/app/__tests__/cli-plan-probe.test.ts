import { expect, it, vi } from 'vitest';
import { publishJsx } from '@/lib/story/jsx-tier';

it('refuses invalid publication before any import hook runs', async () => {
  const importAsset = vi.fn(async () => null);
  const result = await publishJsx({}, '<img src="https://example.com/probe.png" /><UnknownPlanningComponent />', { importAsset });
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(400);
  expect(importAsset).not.toHaveBeenCalled();
});

it('can reject the same invalid markup with the import capability withheld', async () => {
  const result = await publishJsx({}, '<img src="https://example.com/probe.png" /><UnknownPlanningComponent />', {});
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(400);
});
