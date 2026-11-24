import {isValidHandle, RESERVED_HANDLES} from '@artifactbin/contracts/handles';

/** Profile and group writes normalize surrounding whitespace and case before checking the handle. */
export function handleInputError(input: string): string | undefined {
  const handle = input.trim().toLowerCase();
  if (isValidHandle(handle)) return undefined;
  if (RESERVED_HANDLES.has(handle)) return 'This handle is reserved.';
  return 'Use 3–32 letters or numbers, with single underscores between them.';
}
