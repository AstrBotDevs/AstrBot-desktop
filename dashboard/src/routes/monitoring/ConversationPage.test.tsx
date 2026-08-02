// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listConversations } from '@/api/openapi';
import { mockApiResponse, renderRoute } from '@/test/render';
import ConversationPage from './ConversationPage';

vi.mock('@/api/openapi');

describe('ConversationPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads Chat conversations without the legacy webchat exclusions', async () => {
    vi.mocked(listConversations).mockResolvedValue(
      mockApiResponse({
        conversations: [
          {
            cid: 'chat-session-1',
            title: 'Chat conversation',
            user_id: 'webchat:FriendMessage:webchat!user-1',
          },
        ],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }),
    );

    renderRoute(<ConversationPage />);

    expect(await screen.findByText('Chat conversation')).toBeInTheDocument();
    await waitFor(() =>
      expect(listConversations).toHaveBeenCalledWith({
        query: expect.objectContaining({ include_history: false }),
      }),
    );

    const query = vi.mocked(listConversations).mock.calls[0]?.[0]?.query;
    expect(query).not.toHaveProperty('exclude_ids');
    expect(query).not.toHaveProperty('exclude_platforms');
  });
});
