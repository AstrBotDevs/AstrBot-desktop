import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BlankLayout } from './BlankLayout';

describe('BlankLayout', () => {
  it('renders explicit page content in the layout container', () => {
    const markup = renderToStaticMarkup(
      <BlankLayout>
        <p>Authentication page</p>
      </BlankLayout>,
    );

    expect(markup).toContain('class="blank-layout"');
    expect(markup).toContain('data-layout="blank"');
    expect(markup).toContain('>Authentication page<');
  });

  it('renders nested route content through its outlet', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/auth/login']}>
        <Routes>
          <Route element={<BlankLayout />}>
            <Route path="/auth/login" element={<p>Login route</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(markup).toContain('class="blank-layout"');
    expect(markup).toContain('>Login route<');
  });
});
