import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

import { testI18n } from './i18n';

export function renderRoute(
  element: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {},
) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
    </I18nextProvider>,
    options,
  );
}

export function renderStatic(element: ReactElement) {
  return renderToStaticMarkup(<I18nextProvider i18n={testI18n}>{element}</I18nextProvider>);
}

/**
 * Generated API functions expose Axios response types, while page tests only
 * need their runtime envelope. Keep the unavoidable test-double cast here.
 */
export function mockApiResponse<T>(data: T): never {
  return { data: { data, status: 'ok' } } as never;
}
