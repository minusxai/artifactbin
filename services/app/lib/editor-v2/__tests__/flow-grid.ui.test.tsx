import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Grid, GridItem, GridItemContext } from '@/components/kit/grid';
import { useContext } from 'react';
function Embed() {
  return <span>{useContext(GridItemContext) ? 'fills cell' : 'intrinsic height'}</span>;
}
describe('Grid flow mode', () => {
  it('uses intrinsic content height and column spans with the existing components', () => {
    const v = render(
      <Grid mode="flow">
        <GridItem w={6}>
          <p>Long prose</p>
          <Embed />
        </GridItem>
        <GridItem w={6}>Second column</GridItem>
      </Grid>,
    );
    const item = v.getByText('Long prose').parentElement!;
    expect(item.className).not.toContain('overflow-hidden');
    expect(item.className).not.toContain('absolute');
    expect(item.style.getPropertyValue('--gi-min-h')).toBe('0px');
    expect(v.getByText('intrinsic height')).toBeTruthy();
  });
  it('uses an explicit minHeight in flow mode and preserves positioned defaults', () => {
    const v = render(
      <>
        <Grid mode="flow" rowHeight={50}>
          <GridItem minHeight={150}>
            <p>Flow</p>
          </GridItem>
        </Grid>
        <Grid>
          <GridItem>
            <p>Positioned</p>
            <Embed />
          </GridItem>
        </Grid>
      </>,
    );
    expect(v.getByText('Flow').parentElement!.style.getPropertyValue('--gi-min-h')).toBe('150px');
    expect(v.getByText('Positioned').parentElement!.className).toContain('overflow-hidden');
    expect(v.getByText('fills cell')).toBeTruthy();
  });
});
