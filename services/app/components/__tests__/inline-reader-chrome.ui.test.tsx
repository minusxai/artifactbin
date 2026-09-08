import { render,screen,fireEvent } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { InlineReaderChrome } from '../InlineReaderChrome';
it('uses the shared reader bar without obsolete standalone controls panels',()=>{
 const action=vi.fn();const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:{username:'author'}}} onAction={action} />);
 fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(action).toHaveBeenCalledWith('controls');
 expect(screen.queryByLabelText('Artifact controls')).toBeNull();
 expect(view.container.querySelector('[data-mx-reader-panel]')).toBeNull();
 expect(screen.getByLabelText("View @author's profile")).toHaveAttribute('target','_self');
});
