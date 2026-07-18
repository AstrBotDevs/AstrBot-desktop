// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProviderSchema, listProviders, setProviderEnabledById } from '@/api/openapi';
import { deferred } from '@/test/async';
import { mockApiResponse, renderRoute } from '@/test/render';
import ProviderPage from './ProviderPage';

vi.mock('@/api/openapi');
vi.mock('@/components/config/DynamicConfigForm', () => ({ ConfigGroup: () => <div data-testid="config-group" /> }));
const schema = (providers: unknown[] = []) =>
  mockApiResponse({
    config_schema: { provider: { config_template: {} } },
    model_metadata: {},
    provider_sources: [],
    providers,
  });

describe('ProviderPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listProviders).mockResolvedValue(mockApiResponse({ providers: [] }));
  });

  it('renders loading, empty and successful provider states', async () => {
    const request = deferred<Awaited<ReturnType<typeof getProviderSchema<false>>>>();
    vi.mocked(getProviderSchema).mockReturnValue(request.promise);

    renderRoute(<ProviderPage />, { route: '/providers' });
    expect(screen.getByText('core.common.loading')).toBeInTheDocument();
    request.resolve(schema([]));

    expect(await screen.findByText('features.provider.providerSources.empty')).toBeInTheDocument();
  });

  it('shows an error after schema and fallback requests fail', async () => {
    vi.mocked(getProviderSchema).mockRejectedValue(new Error('schema unavailable'));
    vi.mocked(listProviders).mockRejectedValue(new Error('fallback unavailable'));

    renderRoute(<ProviderPage />, { route: '/providers' });

    expect(await screen.findByRole('alert')).toHaveTextContent('schema unavailable');
  });

  it('toggles a provider through the page control', async () => {
    const user = userEvent.setup();
    vi.mocked(getProviderSchema).mockResolvedValue(
      schema([{ enabled: true, id: 'embed-provider', model: 'embed-v1', provider_type: 'embedding' }]),
    );
    vi.mocked(setProviderEnabledById).mockResolvedValue(mockApiResponse({}));

    renderRoute(<ProviderPage />, { route: '/providers' });
    await user.click(await screen.findByRole('button', { name: 'features.provider.providers.tabs.embedding' }));
    await user.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(setProviderEnabledById).toHaveBeenCalledWith({
        body: { enabled: false, provider_id: 'embed-provider' },
      }),
    );
  });
});
