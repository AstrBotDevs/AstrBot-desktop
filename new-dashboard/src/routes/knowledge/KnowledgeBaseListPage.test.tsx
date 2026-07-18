// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createKnowledgeBase, listKnowledgeBases, listProviders } from '@/api/openapi';
import { deferred } from '@/test/async';
import { mockApiResponse, renderRoute } from '@/test/render';
import KnowledgeBaseListPage from './KnowledgeBaseListPage';

vi.mock('@/api/openapi');
const knowledgePage = (items: unknown[] = [], total = items.length) =>
  mockApiResponse({ items, page: 1, page_size: 20, total });

describe('KnowledgeBaseListPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listProviders)
      .mockResolvedValueOnce(
        mockApiResponse({
          providers: [{ id: 'embed-1', model: 'embedding-model', provider_type: 'embedding' }],
        }),
      )
      .mockResolvedValueOnce(
        mockApiResponse({
          providers: [{ id: 'rerank-1', model: 'rerank-model', provider_type: 'rerank' }],
        }),
      );
  });

  it('renders loading, empty, success and pagination states', async () => {
    const request = deferred<Awaited<ReturnType<typeof listKnowledgeBases<false>>>>();
    vi.mocked(listKnowledgeBases).mockReturnValue(request.promise);
    const user = userEvent.setup();

    renderRoute(<KnowledgeBaseListPage />, { route: '/knowledge-base' });
    expect(screen.getByText('features.knowledge-base.index.list.loading')).toBeInTheDocument();

    request.resolve(
      knowledgePage([{ kb_id: 'kb-1', kb_name: 'Product docs', description: 'Reference', document_count: 2 }], 21),
    );
    expect(await screen.findByText('Product docs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'core.common.nextPage' }));
    await waitFor(() =>
      expect(listKnowledgeBases).toHaveBeenLastCalledWith({
        query: { page: 2, page_size: 20, refresh_stats: true },
      }),
    );
  });

  it('shows a page-level error when loading fails', async () => {
    vi.mocked(listKnowledgeBases).mockRejectedValue(new Error('knowledge unavailable'));

    renderRoute(<KnowledgeBaseListPage />, { route: '/knowledge-base' });

    expect(await screen.findByRole('alert')).toHaveTextContent('knowledge unavailable');
  });

  it('creates a knowledge base through the dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(listKnowledgeBases).mockResolvedValue(knowledgePage());
    vi.mocked(createKnowledgeBase).mockResolvedValue(mockApiResponse({ kb_id: 'kb-new' }));

    renderRoute(<KnowledgeBaseListPage />, { route: '/knowledge-base' });
    await screen.findByText('features.knowledge-base.index.list.empty');
    await user.click(screen.getAllByRole('button', { name: 'features.knowledge-base.index.list.create' })[0]);
    await user.type(screen.getByPlaceholderText('features.knowledge-base.index.create.namePlaceholder'), 'Engineering');
    await user.click(
      screen.getByRole('button', {
        name: /features\.knowledge-base\.index\.create\.embeddingModelLabel/,
      }),
    );
    await user.click(screen.getByRole('option', { name: /embedding-model/ }));
    await user.click(screen.getByRole('button', { name: 'features.knowledge-base.index.create.submit' }));

    await waitFor(() =>
      expect(createKnowledgeBase).toHaveBeenCalledWith({
        body: expect.objectContaining({ embedding_provider_id: 'embed-1', kb_name: 'Engineering' }),
      }),
    );
  });
});
