// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createChatSession,
  getChatSession,
  getConfigProfile,
  listChatConfigs,
  listChatProjects,
  listChatSessions,
  listCommands,
  listConfigRoutes,
  listProviders,
  updateChatSession,
} from '@/api/openapi';
import { deferred } from '@/test/async';
import { mockApiResponse, renderRoute } from '@/test/render';
import { runChatStream } from './chatTransport';
import ChatPage from './ChatPage';

vi.mock('@/api/openapi');
vi.mock('./chatTransport', () => ({ runChatStream: vi.fn() }));
vi.mock('@/routes/configuration/ProviderPage', () => ({ default: () => <div>provider workspace</div> }));

describe('ChatPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listChatSessions).mockResolvedValue(mockApiResponse({ sessions: [] }));
    vi.mocked(listChatProjects).mockResolvedValue(mockApiResponse({ projects: [] }));
    vi.mocked(listProviders).mockResolvedValue(mockApiResponse({ model_metadata: {}, providers: [] }));
    vi.mocked(listChatConfigs).mockResolvedValue(mockApiResponse({ info_list: [] }));
    vi.mocked(listConfigRoutes).mockResolvedValue(mockApiResponse({ routes: [] }));
    vi.mocked(listCommands).mockResolvedValue(mockApiResponse({ items: [] }));
    vi.mocked(getConfigProfile).mockResolvedValue(mockApiResponse({ config: {} }));
    vi.mocked(updateChatSession).mockResolvedValue(mockApiResponse({}));
    vi.mocked(runChatStream).mockResolvedValue(undefined);
  });

  it('renders the successful empty-chat state', async () => {
    renderRoute(<ChatPage />, { route: '/chat' });

    expect(await screen.findByText('features.chat.welcome.title')).toBeInTheDocument();
  });

  it('shows a page-level error when conversations cannot load', async () => {
    vi.mocked(listChatSessions).mockRejectedValue(new Error('conversation service unavailable'));

    renderRoute(<ChatPage />, { route: '/chat' });

    expect(await screen.findByRole('alert')).toHaveTextContent('conversation service unavailable');
  });

  it('creates a session and sends a message through the stream layer', async () => {
    const user = userEvent.setup();
    vi.mocked(createChatSession).mockResolvedValue(mockApiResponse({ session_id: 'session-new' }));

    renderRoute(<ChatPage />, { route: '/chat' });
    const composer = await screen.findByPlaceholderText('features.chat.input.placeholder');
    await user.type(composer, 'Hello AstrBot');
    await waitFor(() => expect(screen.getByRole('button', { name: 'features.chat.input.send' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'features.chat.input.send' }));

    await waitFor(() => expect(createChatSession).toHaveBeenCalled());
    expect(runChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'send',
        message: [{ text: 'Hello AstrBot', type: 'plain' }],
        sessionId: 'session-new',
      }),
      expect.any(AbortSignal),
      expect.any(Object),
    );
  });

  it('keeps the newest conversation when requests resolve out of order', async () => {
    const user = userEvent.setup();
    const firstRequest = deferred<Awaited<ReturnType<typeof getChatSession<false>>>>();
    vi.mocked(getChatSession)
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(
        mockApiResponse({
          history: [{ content: { message: [{ text: 'newest response', type: 'plain' }], type: 'bot' }, id: 'm2' }],
        }),
      );

    renderRoute(
      <>
        <Link to="/chat/second">Switch conversation</Link>
        <Routes>
          <Route element={<ChatPage />} path="/chat/:conversationId" />
        </Routes>
      </>,
      { route: '/chat/first' },
    );
    await user.click(screen.getByRole('link', { name: 'Switch conversation' }));
    expect(await screen.findByText('newest response')).toBeInTheDocument();
    firstRequest.resolve(
      mockApiResponse({
        history: [{ content: { message: [{ text: 'stale response', type: 'plain' }], type: 'bot' }, id: 'm1' }],
      }),
    );

    await waitFor(() => expect(screen.queryByText('stale response')).not.toBeInTheDocument());
    expect(screen.getByText('newest response')).toBeInTheDocument();
  });
});
