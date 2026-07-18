import { describe, expect, it } from 'vitest';

import { apiEndpoints } from './endpoints';

describe('API endpoint constants', () => {
  it('encodes dynamic path and query values at the boundary', () => {
    expect(apiEndpoints.backup('name / 中文.zip')).toBe('/api/v1/backups/name%20%2F%20%E4%B8%AD%E6%96%87.zip');
    expect(apiEndpoints.fileByName('folder/a b.png')).toBe('/api/v1/files/content?filename=folder%2Fa%20b.png');
    expect(apiEndpoints.regenerateChatMessage('session / 1', 'message / 2')).toBe(
      '/api/v1/chat/sessions/session%20%2F%201/messages/message%20%2F%202/regenerate',
    );
  });
});
