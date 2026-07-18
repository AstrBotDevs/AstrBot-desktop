import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { DialogActions } from './DialogActions';

describe('shared UI primitives', () => {
  it('applies a consistent button variant while preserving caller classes', () => {
    const markup = renderToStaticMarkup(
      <Button className="feature-action" disabled variant="primary">Save</Button>,
    );

    expect(markup).toContain('ui-button ui-button--primary feature-action');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('type="button"');
  });

  it('keeps optional leading actions separate from the primary action group', () => {
    const markup = renderToStaticMarkup(
      <DialogActions leading={<Button variant="text">Reset</Button>}>
        <Button>Cancel</Button>
        <Button variant="primary">Confirm</Button>
      </DialogActions>,
    );

    expect(markup).toContain('dialog-actions ui-dialog-actions');
    expect(markup).toContain('ui-dialog-actions__leading');
    expect(markup).toContain('Reset');
    expect(markup).toContain('Confirm');
  });
});
