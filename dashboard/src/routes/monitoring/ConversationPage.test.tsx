// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listConversations } from '@/api/openapi';
import { mockApiResponse, renderRoute } from '@/test/render';
import ConversationPage from './ConversationPage';

vi.mock('@/api/openapi');

const conversation = (index: number) => ({
  cid: `chat-session-${index}`,
  title: `Chat conversation ${index}`,
  user_id: `webchat:FriendMessage:webchat!user-${index}`,
});

describe('ConversationPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads Chat conversations without the legacy webchat exclusions', async () => {
    vi.mocked(listConversations).mockResolvedValue(
      mockApiResponse({
        conversations: [conversation(1)],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }),
    );

    renderRoute(<ConversationPage />);

    expect(await screen.findByText('Chat conversation 1')).toBeInTheDocument();
    await waitFor(() =>
      expect(listConversations).toHaveBeenCalledWith({
        query: expect.objectContaining({ include_history: false, page: 1, page_size: 20 }),
      }),
    );

    const query = vi.mocked(listConversations).mock.calls[0]?.[0]?.query;
    expect(query).not.toHaveProperty('exclude_ids');
    expect(query).not.toHaveProperty('exclude_platforms');
  });

  it('loads the next batch of 20 conversations near the scroll bottom', async () => {
    vi.mocked(listConversations)
      .mockResolvedValueOnce(
        mockApiResponse({
          conversations: Array.from({ length: 20 }, (_, index) => conversation(index + 1)),
          pagination: { page: 1, page_size: 20, total: 21, total_pages: 2 },
        }),
      )
      .mockResolvedValueOnce(
        mockApiResponse({
          conversations: [conversation(21)],
          pagination: { page: 2, page_size: 20, total: 21, total_pages: 2 },
        }),
      );

    const { container } = renderRoute(<ConversationPage />);

    expect(await screen.findByText('Chat conversation 20')).toBeInTheDocument();
    const scrollContainer = container.querySelector<HTMLElement>('.monitor-table-wrap');
    expect(scrollContainer).not.toBeNull();
    Object.defineProperties(scrollContainer, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 300 },
    });

    fireEvent.scroll(scrollContainer!);

    expect(await screen.findByText('Chat conversation 21')).toBeInTheDocument();
    expect(listConversations).toHaveBeenNthCalledWith(2, {
      query: expect.objectContaining({ page: 2, page_size: 20 }),
    });
    expect(container.querySelector('.conversation-pagination')).not.toBeInTheDocument();
  });
});
