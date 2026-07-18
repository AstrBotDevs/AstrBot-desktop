// @vitest-environment jsdom

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  batchUpdateSessionService,
  createSessionGroup,
  listActiveUmos,
  listSessionGroups,
  listSessionRules,
} from '@/api/openapi';
import { mockApiResponse, renderRoute } from '@/test/render';
import SessionManagementPage from './SessionManagementPage';

vi.mock('@/api/openapi');
const rulesResponse = (rules: unknown[] = []) => mockApiResponse({ rules, total: rules.length });

describe('SessionManagementPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listSessionGroups).mockResolvedValue(mockApiResponse({ groups: [] }));
    vi.mocked(listActiveUmos).mockResolvedValue(mockApiResponse({ umo_infos: [], umos: [] }));
  });

  it('renders loading and successful session rule data', async () => {
    vi.mocked(listSessionRules).mockResolvedValue(
      rulesResponse([{ rules: { session_service_config: {} }, umo: 'webchat:friend:user-1' }]),
    );

    renderRoute(<SessionManagementPage />, { route: '/session-management' });

    expect(await screen.findByText('user-1')).toBeInTheDocument();
    expect(screen.getByText('features.session-management.customRules.serviceConfig')).toBeInTheDocument();
  });

  it('shows a page-level error when session rules cannot load', async () => {
    vi.mocked(listSessionRules).mockRejectedValue(new Error('session rules unavailable'));

    renderRoute(<SessionManagementPage />, { route: '/session-management' });

    expect(await screen.findByRole('alert')).toHaveTextContent('session rules unavailable');
  });

  it('creates a session group through the dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(listSessionRules).mockResolvedValue(rulesResponse());
    vi.mocked(createSessionGroup).mockResolvedValue(mockApiResponse({ id: 'group-new' }));

    renderRoute(<SessionManagementPage />, { route: '/session-management' });
    await screen.findByText('features.session-management.customRules.noRules');
    await user.click(screen.getByRole('button', { name: 'features.session-management.groups.create' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'features.session-management.groups.name' }), 'Team');
    await user.click(within(dialog).getByRole('button', { name: 'features.session-management.buttons.save' }));

    await waitFor(() =>
      expect(createSessionGroup).toHaveBeenCalledWith({
        body: { name: 'Team', umos: [] },
      }),
    );
  });

  it('applies a batch rule update to selected sessions', async () => {
    const user = userEvent.setup();
    vi.mocked(listSessionRules).mockResolvedValue(rulesResponse([{ rules: {}, umo: 'webchat:friend:user-1' }]));
    vi.mocked(batchUpdateSessionService).mockResolvedValue(mockApiResponse({}));

    renderRoute(<SessionManagementPage />, { route: '/session-management' });
    await screen.findByText('user-1');
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'features.session-management.batchOperations.llmStatus' }),
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'features.session-management.batchOperations.apply' }));

    await waitFor(() =>
      expect(batchUpdateSessionService).toHaveBeenCalledWith({
        body: { llm_enabled: true, umos: ['webchat:friend:user-1'] },
      }),
    );
  });
});
