import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { renderStatic } from '@/test/render';
import { ChatComposer } from './ChatComposer';

const composerStyles = readFileSync(new URL('./ChatComposer.scss', import.meta.url), 'utf8');

describe('ChatComposer', () => {
  it('derives the composer surface and controls from shared theme tokens', () => {
    expect(composerStyles).toContain('--chat-composer-background: var(--astrbot-surface)');
    expect(composerStyles).toContain('--chat-composer-color: var(--astrbot-text)');
    expect(composerStyles).toContain('--chat-composer-border: var(--astrbot-border)');
    expect(composerStyles).not.toMatch(/--chat-composer-(?:background|color|border),\s*#/);
  });

  it('disables configuration changes while the composer is busy', () => {
    const markup = renderStatic(
      <ChatComposer
        commandSuggestionsLabel="Commands"
        configs={[
          { id: 'default', name: 'Default' },
          { id: 'profile-1', name: 'Profile 1' },
        ]}
        configId="default"
        busy
        labels={{ config: 'Configuration' }}
        onChange={() => undefined}
        onConfigChange={() => undefined}
        onSend={() => undefined}
        value=""
      />,
    );

    expect(markup).toContain('<select aria-label="Configuration" disabled=""');
    expect(markup).toContain('<textarea aria-label=""');
    expect(markup).not.toContain('<textarea aria-label="" disabled=""');
  });

  it('only disables draft input when the whole composer is unavailable', () => {
    const markup = renderStatic(
      <ChatComposer
        commandSuggestionsLabel="Commands"
        disabled
        onChange={() => undefined}
        onSend={() => undefined}
        value=""
      />,
    );

    expect(markup).toContain('<textarea aria-label="" disabled=""');
  });
});
