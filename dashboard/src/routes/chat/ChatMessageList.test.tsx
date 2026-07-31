import { describe, expect, it } from 'vitest';

import { renderStatic } from '@/test/render';
import { ChatMessageList } from './ChatMessageList';

describe('ChatMessageList', () => {
  it('renders one lightweight thinking indicator while a reply is starting', () => {
    const markup = renderStatic(
      <ChatMessageList
        labels={{ loading: 'Thinking...', running: 'Running' }}
        messages={[
          {
            id: 'pending-reply',
            content: { type: 'bot', message: [], isLoading: true },
          },
        ]}
        streaming
      />,
    );

    expect(markup.match(/ab-chat-message-spinner/g)).toHaveLength(1);
    expect(markup).toContain('<span class="ab-chat-message-loading">Thinking...</span>');
    expect(markup).not.toContain('>Running<');
  });
});
