// @vitest-environment jsdom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { chatTransportPreference } from '@/config/preferences';
import { renderRoute } from '@/test/render';
import { ChatTransportSetting } from './ChatTransportSetting';

describe('ChatTransportSetting', () => {
  beforeEach(() => localStorage.clear());

  it('persists the selected transport mode', async () => {
    const user = userEvent.setup();
    renderRoute(<ChatTransportSetting />);

    await user.click(screen.getByRole('button', { name: 'features.settings.chat.transport.title' }));
    await user.click(screen.getByRole('option', { name: 'features.settings.chat.transport.websocket' }));

    expect(chatTransportPreference.read()).toBe('websocket');
    expect(screen.getByRole('button', { name: 'features.settings.chat.transport.title' })).toHaveTextContent(
      'features.settings.chat.transport.websocket',
    );
  });
});
