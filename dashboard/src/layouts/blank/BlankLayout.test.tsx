import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BlankLayout } from './BlankLayout';

describe('BlankLayout', () => {
  it('renders explicit page content in the layout container', () => {
    const markup = renderToStaticMarkup(
      <BlankLayout>
        <p>Chat page</p>
      </BlankLayout>,
    );

    expect(markup).toContain('class="blank-layout"');
    expect(markup).toContain('data-layout="blank"');
    expect(markup).toContain('>Chat page<');
  });

  it('renders nested route content through its outlet', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/chatbox/session-1']}>
        <Routes>
          <Route element={<BlankLayout />}>
            <Route path="/chatbox/:conversationId" element={<p>Chatbox route</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(markup).toContain('class="blank-layout"');
    expect(markup).toContain('>Chatbox route<');
  });
});
