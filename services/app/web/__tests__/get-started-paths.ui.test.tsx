import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {MemoryRouter} from 'react-router';
import {TokensNewPage} from '@/web/pages/TokensNew';
afterEach(cleanup);

it.each(['', '?source=claude-code'])('the token page omits onboarding (%s)', (search) => {
  render(<MemoryRouter initialEntries={[`/tokens/new${search}`]}><TokensNewPage /></MemoryRouter>);
  expect(screen.queryByLabelText('Get started')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate a token' })).toBeInTheDocument();
});
