import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ExpandCollapse } from './ExpandCollapse';

describe('ExpandCollapse', () => {
  it('exposes open state without removing its content', () => {
    const markup = renderToStaticMarkup(
      <ExpandCollapse open>
        <button>Action</button>
      </ExpandCollapse>,
    );

    expect(markup).toContain('data-state="open"');
    expect(markup).toContain('<button>Action</button>');
    expect(markup).toContain('aria-hidden="false"');
  });

  it('makes closed content inert while retaining it for the leave animation', () => {
    const markup = renderToStaticMarkup(
      <ExpandCollapse open={false}>
        <button>Action</button>
      </ExpandCollapse>,
    );

    expect(markup).toContain('data-state="closed"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
    expect(markup).toContain('<button>Action</button>');
  });
});
