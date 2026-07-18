import { describe, expect, it } from 'vitest';

import { renderStatic } from '@/test/render';
import { ChatComposer } from './ChatComposer';

describe('ChatComposer', () => {
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
