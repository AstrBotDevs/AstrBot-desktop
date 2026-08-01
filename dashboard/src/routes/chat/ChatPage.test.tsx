// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/http';
import { selectedModelPreference, selectedProviderPreference } from '@/config/preferences';
import { useLayoutStore } from '@/stores/layout';
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
import { chatStreamRegistry, resetChatStreamRegistry } from './chatStreamRegistry';
import ChatPage from './ChatPage';

vi.mock('@/api/openapi');
vi.mock('./chatTransport', () => ({ runChatStream: vi.fn() }));
vi.mock('@/routes/configuration/ProviderPage', () => ({ default: () => <div>provider workspace</div> }));

function CurrentPath() {
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

describe('ChatPage', () => {
  beforeEach(() => {
    resetChatStreamRegistry();
    vi.resetAllMocks();
    localStorage.clear();
    useLayoutStore.setState({ settingsOpen: false, settingsSection: 'general' });
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

  it('links sidebar settings to the Bot settings page without duplicate controls', async () => {
    const user = userEvent.setup();
    renderRoute(<ChatPage />, { route: '/chat' });

    await screen.findByText('features.chat.welcome.title');
    const settings = screen.getByRole('button', { name: 'core.common.settings' });
    await user.click(settings);
    expect(useLayoutStore.getState().settingsOpen).toBe(true);
    expect(screen.queryByText('features.chat.transport.title')).not.toBeInTheDocument();
    expect(screen.queryByText('core.common.language')).not.toBeInTheDocument();
    expect(screen.queryByText('features.chat.modes.darkMode')).not.toBeInTheDocument();
    expect(screen.queryByText('features.chat.modes.lightMode')).not.toBeInTheDocument();
  });

  it('shows a page-level error when conversations cannot load', async () => {
    vi.mocked(listChatSessions).mockRejectedValue(new Error('conversation service unavailable'));

    renderRoute(<ChatPage />, { route: '/chat' });

    expect(await screen.findByRole('alert')).toHaveTextContent('conversation service unavailable');
  });

  it.each([
    new ApiError('Session stale-session not found', 404, null),
    new ApiError('Session stale-session not found', 200, { status: 'error' }),
  ])('returns to a new chat when the selected session no longer exists', async (missingSessionError) => {
    vi.mocked(getChatSession).mockRejectedValue(missingSessionError);

    renderRoute(
      <>
        <CurrentPath />
        <Routes>
          <Route element={<ChatPage />} path="/chat" />
          <Route element={<ChatPage />} path="/chat/:conversationId" />
        </Routes>
      </>,
      { route: '/chat/stale-session' },
    );

    await waitFor(() => expect(screen.getByRole('status', { name: 'current path' })).toHaveTextContent('/chat'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText('features.chat.welcome.title')).toBeInTheDocument();
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

  it('replaces a removed persisted provider before sending the first message', async () => {
    const user = userEvent.setup();
    localStorage.setItem('selectedProvider', 'removed-provider');
    localStorage.setItem('selectedProviderModel', 'removed-model');
    vi.mocked(listProviders).mockResolvedValue(
      mockApiResponse({
        model_metadata: {},
        providers: [{ enable: true, id: 'available-provider', model: 'available-model' }],
      }),
    );
    vi.mocked(createChatSession).mockResolvedValue(mockApiResponse({ session_id: 'session-new' }));

    renderRoute(<ChatPage />, { route: '/chat' });

    const composer = await screen.findByPlaceholderText('features.chat.input.placeholder');
    await waitFor(() => expect(selectedProviderPreference.read()).toBe('available-provider'));
    expect(selectedModelPreference.read()).toBe('available-model');
    await user.type(composer, 'Use the available provider');
    await user.click(screen.getByRole('button', { name: 'features.chat.input.send' }));

    await waitFor(() => expect(runChatStream).toHaveBeenCalled());
    expect(runChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModel: 'available-model',
        selectedProvider: 'available-provider',
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

  it('keeps an active chat stream alive while navigating to another dashboard page', async () => {
    const user = userEvent.setup();
    const stream = deferred<void>();
    let streamSignal: AbortSignal | undefined;
    let deliverPayload: ((payload: unknown) => void) | undefined;
    vi.mocked(getChatSession).mockResolvedValue(mockApiResponse({ history: [] }));
    vi.mocked(runChatStream).mockImplementation(async (_action, signal, callbacks) => {
      streamSignal = signal;
      deliverPayload = callbacks.onPayload;
      await stream.promise;
    });

    renderRoute(
      <>
        <Link to="/logs">Open logs</Link>
        <Link to="/chat/session-1">Return to chat</Link>
        <Routes>
          <Route element={<ChatPage />} path="/chat/:conversationId" />
          <Route element={<div>Logs page</div>} path="/logs" />
        </Routes>
      </>,
      { route: '/chat/session-1' },
    );

    const composer = await screen.findByPlaceholderText('features.chat.input.placeholder');
    await user.type(composer, 'Keep generating');
    await user.click(screen.getByRole('button', { name: 'features.chat.input.send' }));
    await waitFor(() => expect(runChatStream).toHaveBeenCalled());
    expect(deliverPayload).toEqual(expect.any(Function));
    expect(chatStreamRegistry.messageCache['session-1']).toHaveLength(2);

    await user.click(screen.getByRole('link', { name: 'Open logs' }));
    expect(await screen.findByText('Logs page')).toBeInTheDocument();
    expect(streamSignal?.aborted).toBe(false);

    await user.click(screen.getByRole('link', { name: 'Return to chat' }));
    await screen.findByPlaceholderText('features.chat.input.placeholder');
    expect(chatStreamRegistry.messageCache['session-1']).toHaveLength(2);
    expect(await screen.findByText('Keep generating')).toBeInTheDocument();
    deliverPayload?.({ type: 'plain', data: 'Still connected', streaming: true });
    expect(chatStreamRegistry.messageCache['session-1'][1].content.message).toContainEqual({
      text: 'Still connected',
      type: 'plain',
    });

    stream.resolve();
  });
});
